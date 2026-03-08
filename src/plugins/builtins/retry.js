// Retry Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  retries: 3,
  retryDelay: 100, // ms
  retryOn: [502, 503, 504], // status codes
  retryMethods: ['GET', 'HEAD', 'OPTIONS'],
  backoff: 'linear' // 'linear' or 'exponential'
};

export default {
  name: 'retry',
  version: '1.0.0',
  description: 'Automatic retry on upstream failures',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.retry || DEFAULT_OPTIONS;
    
    // Only retry safe methods
    if (!options.retryMethods.includes(req.method)) {
      return next();
    }

    req._retryCount = 0;
    req._retryOptions = options;

    // Store original methods
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalStatus = res.statusCode;

    res.send = (body) => {
      // Check if should retry
      const shouldRetry = options.retryOn.includes(res.statusCode) && 
        req._retryCount < options.retries;

      if (shouldRetry) {
        req._retryCount++;
        
        const delay = options.backoff === 'exponential'
          ? options.retryDelay * Math.pow(2, req._retryCount - 1)
          : options.retryDelay;

        logger.info(`Retrying request (${req._retryCount}/${options.retries}) after ${delay}ms`);
        
        // Add retry header
        res.set('X-Retry', req._retryCount.toString());
        
        // Wait and retry
        setTimeout(() => {
          // Re-emit to express to reprocess
          req.emit('retry', { attempt: req._retryCount });
        }, delay);
        
        return;
      }

      return originalSend(body);
    };

    res.json = (body) => res.send(JSON.stringify(body));

    next();
  }
};
