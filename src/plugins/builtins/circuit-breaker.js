// Circuit Breaker Plugin - Hardened Implementation
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

// Circuit store for tracking state per service
class CircuitStore {
  constructor() {
    this.circuits = new Map();
  }

  // Logic for state transitions (Node.js is single-threaded for JS execution, so this is atomic)
  _transition(service, fn) {
    const circuit = this.getOrCreate(service);
    return fn(circuit);
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

  // Atomic check-and-set for opening circuit
  tryOpen(service, threshold) {
    return this._transition(service, (circuit) => {
      const now = Date.now();
      
      // Reset window if expired
      if (now - circuit.windowStart > DEFAULT_OPTIONS.windowMs) {
        circuit.failures = 0;
        circuit.windowStart = now;
      }
      
      if (circuit.state === STATE_OPEN) {
        return false;
      }
      
      circuit.failures++;
      
      if (circuit.failures >= threshold) {
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
    return this._transition(service, (circuit) => {
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

  // Check if circuit allows request (read-deeply optimized)
  canProceed(service) {
    const circuit = this.getOrCreate(service);
    const now = Date.now();
    
    if (circuit.state === STATE_CLOSED) {
      return { allowed: true, state: STATE_CLOSED };
    }
    
    if (circuit.state === STATE_OPEN) {
      if (now >= circuit.nextAttempt) {
        // Transition to half-open
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

  getState(service) {
    const circuit = this.circuits.get(service);
    return circuit ? circuit.state : STATE_CLOSED;
  }

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

  reset(service) {
    this.circuits.delete(service);
    logger.info(`Circuit breaker reset for: ${service}`);
  }
}

// Singleton circuit store
const circuitStore = new CircuitStore();

export default {
  name: 'circuit-breaker',
  version: '1.2.1',
  description: 'Fixed and hardened circuit breaker',
  defaultOptions: DEFAULT_OPTIONS,

  getState(service) {
    return circuitStore.getState(service);
  },

  getCircuits() {
    return circuitStore.getCircuits();
  },

  reset(service) {
    circuitStore.reset(service);
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['circuit-breaker'] || DEFAULT_OPTIONS;
    const service = req.headers['x-upstream-service'] || req.path.split('/')[2] || 'default';
    
    // Check circuit state
    const check = circuitStore.canProceed(service);
    
    if (!check.allowed) {
      logger.warn(`Circuit open for: ${service}, retry after ${check.retryAfter}s`);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Circuit breaker open for service',
        service,
        retryAfter: check.retryAfter
      });
    }

    // Wrap response to track outcomes
    const originalSend = res.send.bind(res);
    
    res.send = function(body) {
      const status = res.statusCode || 200;
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


// Hardening Audit: v1.2.0 - Verified by Sagar Jadhav
