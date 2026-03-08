// Rate Limiter Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  windowMs: 60000,
  maxRequests: 100,
  keyPrefix: 'ratelimit:',
  message: 'Too Many Requests'
};

// In-memory store
const store = new Map();

export default {
  name: 'rate-limiter',
  version: '1.0.0',
  description: 'Rate limiting plugin for API Gateway',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    // Get options from request (set by plugin manager)
    const options = req._pluginOptions?.['rate-limiter'] || DEFAULT_OPTIONS;
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + options.windowMs
      };
      store.set(key, record);
    }

    record.count++;

    // Set rate limit headers
    res.set('X-RateLimit-Limit', options.maxRequests);
    res.set('X-RateLimit-Remaining', Math.max(0, options.maxRequests - record.count));
    res.set('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.maxRequests) {
      logger.warn(`Rate limit exceeded for ${key}`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: options.message,
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }

    next();
  }
};
