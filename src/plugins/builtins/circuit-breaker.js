// Circuit Breaker Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  failureThreshold: 5,    // Failures before opening circuit
  successThreshold: 2,    // Successes before closing circuit
  timeout: 30000,         // Time before attempting reset (ms)
  windowMs: 60000,        // Time window for counting failures
  passthrough: false
};

// Circuit states
const STATE_CLOSED = 'closed';
const STATE_OPEN = 'open';
const STATE_HALF_OPEN = 'half-open';

// In-memory circuit store
const circuits = new Map();

export default {
  name: 'circuit-breaker',
  version: '1.0.0',
  description: 'Circuit breaker for upstream services',
  defaultOptions: DEFAULT_OPTIONS,

  // Get circuit state
  getState(service) {
    return circuits.get(service)?.state || STATE_CLOSED;
  },

  // Get all circuits
  getCircuits() {
    const result = {};
    for (const [service, state] of circuits.entries()) {
      result[service] = {
        state: state.state,
        failures: state.failures,
        successes: state.successes,
        nextAttempt: state.nextAttempt
      };
    }
    return result;
  },

  // Manual reset
  reset(service) {
    circuits.delete(service);
    logger.info(`Circuit breaker reset for: ${service}`);
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['circuit-breaker'] || DEFAULT_OPTIONS;
    
    // Use the upstream service from headers or path
    const service = req.headers['x-upstream-service'] || req.path.split('/')[2] || 'default';
    
    let circuit = circuits.get(service);
    const now = Date.now();

    // Initialize circuit if not exists
    if (!circuit) {
      circuit = {
        state: STATE_CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: 0,
        windowStart: now
      };
      circuits.set(service, circuit);
    }

    // Reset window if expired
    if (now - circuit.windowStart > options.windowMs) {
      circuit.failures = 0;
      circuit.windowStart = now;
    }

    // Check if circuit is open
    if (circuit.state === STATE_OPEN) {
      if (now >= circuit.nextAttempt) {
        circuit.state = STATE_HALF_OPEN;
        logger.info(`Circuit half-open for: ${service}`);
      } else {
        logger.warn(`Circuit open for: ${service}`);
        return res.status(503).json({
          error: 'Service Unavailable',
          message: `Circuit breaker open for service`,
          service,
          retryAfter: Math.ceil((circuit.nextAttempt - now) / 1000)
        });
      }
    }

    // Wrap response to track failures/successes
    const originalSend = res.send;
    res.send = (body) => {
      const status = res.statusCode;
      const isError = status >= 500;

      if (isError) {
        circuit.failures++;
        
        if (circuit.failures >= options.failureThreshold) {
          circuit.state = STATE_OPEN;
          circuit.nextAttempt = now + options.timeout;
          logger.error(`Circuit opened for: ${service} (${circuit.failures} failures)`);
        }
      } else {
        circuit.successes++;
        
        if (circuit.state === STATE_HALF_OPEN) {
          if (circuit.successes >= options.successThreshold) {
            circuit.state = STATE_CLOSED;
            circuit.failures = 0;
            circuit.successes = 0;
            logger.info(`Circuit closed for: ${service}`);
          }
        }
      }

      return originalSend(body);
    };

    next();
  }
};
