// Retry Plugin - Production-Ready with Load Balancer Coordination
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  retries: 3,
  retryDelay: 100,
  retryOn: [502, 503, 504],
  retryMethods: ['GET', 'HEAD', 'OPTIONS'],
  backoff: 'exponential',
  maxRetryTime: 5000,
  // NEW: Coordination with load balancer
  coordinateWithLoadBalancer: true,
  // NEW: Jitter to prevent thundering herd
  jitter: true,
  maxJitterMs: 200,
  // NEW: Circuit breaking coordination
  trackRetriesAsFailures: false  // Set true to count retries as failures in LB
};

export default {
  name: 'retry',
  version: '1.2.0',
  description: 'Production-ready retry with load balancer coordination and jitter',
  defaultOptions: DEFAULT_OPTIONS,

  // Track retry counts per target for better metrics
  targetRetryCounts: new Map(),

  handler: (req, res, next) => {
    const options = req._pluginOptions?.retry || DEFAULT_OPTIONS;
    
    if (!options.retryMethods.includes(req.method)) {
      return next();
    }

    req._retryCount = 0;
    req._retryStartTime = Date.now();
    req._retryTargets = [];  // Track which targets were retried
    
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    let responseHandled = false;

    // Calculate delay with exponential backoff and jitter
    const calculateDelay = (attempt) => {
      let delay = options.backoff === 'exponential'
        ? options.retryDelay * Math.pow(2, attempt - 1)
        : options.retryDelay;
      
      // Add jitter to prevent thundering herd
      if (options.jitter) {
        const jitter = Math.random() * options.maxJitterMs;
        delay += jitter;
      }
      
      return Math.min(delay, options.maxRetryTime);
    };

    // Handle response and check for retry
    const handleResponse = (body, isJson = false) => {
      if (responseHandled) {
        return;
      }
      
      const status = res.statusCode;
      const elapsed = Date.now() - req._retryStartTime;
      const shouldRetry = options.retryOn.includes(status) && 
        req._retryCount < options.retries &&
        elapsed < options.maxRetryTime;

      if (shouldRetry) {
        responseHandled = true;
        req._retryCount++;
        
        // NEW: Coordinate with load balancer (Ben's suggestion #11)
        if (options.coordinateWithLoadBalancer && req._onResponse) {
          const route = req.path;
          const geo = req.geo || 'unknown';
          req._onResponse(false, elapsed, route, geo);
          logger.debug(`Penalized load balancer target ${req._target} due to retry`);
        }

        // Track target for metrics
        if (req._target) {
          req._retryTargets.push(req._target);
          const count = this.targetRetryCounts.get(req._target) || 0;
          this.targetRetryCounts.set(req._target, count + 1);
        }
        
        const delay = calculateDelay(req._retryCount);
        
        logger.info(`Retrying request (${req._retryCount}/${options.retries}) after ${Math.round(delay)}ms, status=${status}, target=${req._target}`);
        
        // Add retry headers for debugging
        res.set('X-Retry-Count', req._retryCount.toString());
        res.set('X-Retry-Delay', Math.round(delay).toString());
        if (req._target) {
          res.set('X-Retry-Target', req._target);
        }
        
        // IMPORTANT: Clear current target so next LB call picks a new one (if LB is active)
        const oldTarget = req._target;
        delete req._target; 

        responseHandled = false;
        
        // Emit retry event with target info
        setTimeout(() => {
          req.emit('retry', { 
            attempt: req._retryCount, 
            delay,
            target: oldTarget,
            status
          });
        }, delay);
        
        return;
      }

      responseHandled = true;
      
      // Add final retry info headers
      if (req._retryCount > 0) {
        res.set('X-Total-Retries', req._retryCount.toString());
        res.set('X-Retry-Targets', req._retryTargets.join(','));
      }
      
      if (isJson) {
        return originalJson(body);
      }
      return originalSend(body);
    };

    // Override response methods
    res.send = (body) => {
      return handleResponse(body, false);
    };

    res.json = (body) => {
      return handleResponse(body, true);
    };

    // NEW: Expose retry state for load balancer
    req._getRetryCount = () => req._retryCount;
    req._getRetryTargets = () => req._retryTargets;

    next();
  },

  // Get retry statistics
  getStats() {
    return {
      targetRetries: Object.fromEntries(this.targetRetryCounts)
    };
  },

  // Reset stats
  resetStats() {
    this.targetRetryCounts.clear();
  }
};
