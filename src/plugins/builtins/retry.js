// Retry Plugin - Proper Implementation with Memory Safety
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  retries: 3,
  retryDelay: 100, // ms
  retryOn: [502, 503, 504], // status codes
  retryMethods: ['GET', 'HEAD', 'OPTIONS'],
  backoff: 'linear', // 'linear' or 'exponential'
  maxRetryTime: 5000 // Maximum total time for retries
};

export default {
  name: 'retry',
  version: '1.1.0',
  description: 'Automatic retry on upstream failures with proper memory management',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.retry || DEFAULT_OPTIONS;
    
    // Only retry safe methods
    if (!options.retryMethods.includes(req.method)) {
      return next();
    }

    // Track retry state on request
    req._retryCount = 0;
    req._retryStartTime = Date.now();
    
    // Store original methods
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    
    // Track if we've already handled this response
    let responseHandled = false;

    // Override send to check for retry conditions
    const handleResponse = (body, isJson = false) => {
      // Prevent double handling
      if (responseHandled) {
        return;
      }
      
      const status = res.statusCode;
      const shouldRetry = options.retryOn.includes(status) && 
        req._retryCount < options.retries &&
        (Date.now() - req._retryStartTime) < options.maxRetryTime;

      if (shouldRetry) {
        responseHandled = true;
        req._retryCount++;
        
        const delay = options.backoff === 'exponential'
          ? options.retryDelay * Math.pow(2, req._retryCount - 1)
          : options.retryDelay;

        logger.info(`Retrying request (${req._retryCount}/${options.retries}) after ${delay}ms, status=${status}`);
        
        // Add retry header
        res.set('X-Retry-Count', req._retryCount.toString());
        
        // Reset response state for retry
        responseHandled = false;
        
        // Wait and retry via express router re-dispatch
        setTimeout(() => {
          // Emit retry event to restart request processing
          req.emit('retry', { attempt: req._retryCount, delay });
        }, delay);
        
        return; // Don't send response yet
      }

      // No retry needed, send response normally
      responseHandled = true;
      if (isJson) {
        return originalJson(body);
      }
      return originalSend(body);
    };

    // Override res.send to intercept status codes
    res.send = (body) => {
      return handleResponse(body, false);
    };

    res.json = (body) => {
      return handleResponse(body, true);
    };

    next();
  }
};
