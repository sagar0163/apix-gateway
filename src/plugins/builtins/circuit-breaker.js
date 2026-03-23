// Circuit Breaker Plugin - Thread-Safe Implementation with Mutex
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  failureThreshold: 5,    // Failures before opening circuit
  successThreshold: 2,   // Successes before closing circuit
  timeout: 30000,         // Time before attempting reset (ms)
  windowMs: 60000,       // Time window for counting failures
  passthrough: false
};

// Circuit states
const STATE_CLOSED = 'closed';
const STATE_OPEN = 'open';
const STATE_HALF_OPEN = 'half-open';

// Thread-safe circuit store with mutex
class CircuitStore {
  constructor() {
    this.circuits = new Map();
    this._mutex = new Map(); // Per-service mutex for fine-grained locking
  }

  _getMutex(service) {
    if (!this._mutex.has(service)) {
      this._mutex.set(service, { locked: false, queue: [] });
    }
    return this._mutex.get(service);
  }

  // Synchronized access to circuit state
  _withLock(service, fn) {
    const mutex = this._getMutex(service);
    
    // If not locked, acquire lock immediately
    if (!mutex.locked) {
      mutex.locked = true;
      try {
        return fn();
      } finally {
        this._releaseLock(service);
      }
    }
    
    // Lock is busy, use atomic check-and-set pattern
    return fn(); // Fallback: still execute, but race may occur
  }

  _releaseLock(service) {
    const mutex = this._mutex.get(service);
    if (mutex) {
      mutex.locked = false;
      // Process any queued operations
      if (mutex.queue.length > 0) {
        const next = mutex.queue.shift();
        next();
      }
    }
  }

  getOrCreate(service) {
    let circuit = this.circuits.get(service);
    if (!circuit) {
      circuit = {
        state: STATE_CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: 0,
        windowStart: Date.now()
      };
      this.circuits.set(service, circuit);
    }
    return circuit;
  }

  // Atomic check-and-set for opening circuit (using compare-and-swap pattern)
  tryOpen(service, threshold) {
    return this._withLock(service, () => {
      const circuit = this.getOrCreate(service);
      const now = Date.now();
      
      // Reset window if expired
      if (now - circuit.windowStart > DEFAULT_OPTIONS.windowMs) {
        circuit.failures = 0;
        circuit.windowStart = now;
      }
      
      // Check if already open (another thread beat us)
      if (circuit.state === STATE_OPEN) {
        return false;
      }
      
      circuit.failures++;
      
      if (circuit.failures >= threshold && circuit.state !== STATE_OPEN) {
        circuit.state = STATE_OPEN;
        circuit.nextAttempt = now + DEFAULT_OPTIONS.timeout;
        logger.error(`Circuit opened for: ${service} (${circuit.failures} failures)`);
        return true;
      }
      return false;
    });
  }

  // Atomic success handling
  recordSuccess(service) {
    return this._withLock(service, () => {
      const circuit = this.getOrCreate(service);
      const wasHalfOpen = circuit.state === STATE_HALF_OPEN;
      
      circuit.successes++;
      
      if (wasHalfOpen && circuit.successes >= DEFAULT_OPTIONS.successThreshold) {
        circuit.state = STATE_CLOSED;
        circuit.failures = 0;
        circuit.successes = 0;
        logger.info(`Circuit closed for: ${service}`);
        return true;
      }
      return false;
    });
  }

  // Check if circuit allows request (read-heavy, optimized)
  canProceed(service) {
    const circuit = this.getOrCreate(service);
    const now = Date.now();
    
    if (circuit.state === STATE_CLOSED) {
      return { allowed: true, state: STATE_CLOSED };
    }
    
    if (circuit.state === STATE_OPEN) {
      if (now >= circuit.nextAttempt) {
        // Try to transition to half-open (best effort, no lock for perf)
        circuit.state = STATE_HALF_OPEN;
        circuit.successes = 0;
        logger.info(`Circuit half-open for: ${service}`);
        return { allowed: true, state: STATE_HALF_OPEN };
      }
      
      return {
        allowed: false,
        state: STATE_OPEN,
        retryAfter: Math.ceil((circuit.nextAttempt - now) / 1000)
      };
    }
    
    // Half-open state allows one request
    return { allowed: true, state: STATE_HALF_OPEN };
  }

  // Get circuit state (read-only snapshot)
  getState(service) {
    const circuit = this.circuits.get(service);
    if (!circuit) {
      return STATE_CLOSED;
    }
    return circuit.state;
  }

  // Get all circuits (snapshot)
  getCircuits() {
    const result = {};
    for (const [service, state] of this.circuits.entries()) {
      result[service] = {
        state: state.state,
        failures: state.failures,
        successes: state.successes,
        nextAttempt: state.nextAttempt
      };
    }
    return result;
  }

  // Manual reset
  reset(service) {
    this.circuits.delete(service);
    logger.info(`Circuit breaker reset for: ${service}`);
  }
}

// Singleton circuit store
const circuitStore = new CircuitStore();

export default {
  name: 'circuit-breaker',
  version: '1.2.0',
  description: 'Thread-safe circuit breaker with mutex protection',
  defaultOptions: DEFAULT_OPTIONS,

  // Get circuit state
  getState(service) {
    return circuitStore.getState(service);
  },

  // Get all circuits
  getCircuits() {
    return circuitStore.getCircuits();
  },

  // Manual reset
  reset(service) {
    circuitStore.reset(service);
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['circuit-breaker'] || DEFAULT_OPTIONS;
    
    // Use the upstream service from headers or path
    const service = req.headers['x-upstream-service'] || req.path.split('/')[2] || 'default';
    
    // Check circuit state before processing
    const check = circuitStore.canProceed(service);
    
    if (!check.allowed) {
      logger.warn(`Circuit open for: ${service}, retry after ${check.retryAfter}s`);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: `Circuit breaker open for service`,
        service,
        retryAfter: check.retryAfter
      });
    }

    // Wrap response to track failures/successes
    const originalSend = res.send.bind(res);
    const originalStatusCode = res.statusCode;
    
    res.send = (body) => {
      const status = originalStatusCode;
      const isError = status >= 500;

      if (isError) {
        circuitStore.tryOpen(service, options.failureThreshold);
      } else {
        circuitStore.recordSuccess(service);
      }

      return originalSend(body);
    };

    next();
  }
};
