// Quota Management Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  quota: 1000, // requests per window
  window: 'day', // 'minute', 'hour', 'day', 'month'
  syncInterval: 60, // seconds
  keyBy: 'user' // 'user', 'api-key', 'ip'
};

// In-memory quota storage
const quotas = new Map();

export default {
  name: 'quota',
  version: '1.0.0',
  description: 'Request quota management',
  defaultOptions: DEFAULT_OPTIONS,

  // Get window in ms
  getWindowMs(window) {
    const map = {
      minute: 60000,
      hour: 3600000,
      day: 86400000,
      month: 2592000000
    };
    return map[window] || 86400000;
  },

  // Get quota key
  getKey(req, options) {
    if (options.keyBy === 'user' && req.user) {
      return req.user.id || req.user.sub;
    }
    if (options.keyBy === 'api-key' && req.apiKey) {
      return req.apiKey.key;
    }
    return req.ip || 'unknown';
  },

  // Check quota
  check(key, quota, windowMs) {
    const now = Date.now();
    const record = quotas.get(key);

    if (!record || now > record.resetTime) {
      quotas.set(key, {
        used: 0,
        resetTime: now + windowMs
      });
      return { allowed: true, remaining: quota, resetAt: new Date(now + windowMs) };
    }

    if (record.used >= quota) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(record.resetTime),
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      };
    }

    record.used++;
    return {
      allowed: true,
      remaining: quota - record.used,
      resetAt: new Date(record.resetTime)
    };
  },

  // Get quota status
  getStatus(key) {
    return quotas.get(key);
  },

  // Reset quota
  reset(key) {
    quotas.delete(key);
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.quota || DEFAULT_OPTIONS;
    const key = this.getKey(req, options);
    const windowMs = this.getWindowMs(options.window);

    const result = this.check(key, options.quota, windowMs);

    // Set quota headers
    res.set('X-Quota-Limit', options.quota.toString());
    res.set('X-Quota-Remaining', result.remaining.toString());
    res.set('X-Quota-Reset', Math.ceil(result.resetAt.getTime() / 1000).toString());

    if (!result.allowed) {
      logger.warn(`Quota exceeded for ${key}`);
      return res.status(429).json({
        error: 'Quota Exceeded',
        message: `API quota of ${options.quota} ${options.window} exceeded`,
        quota: options.quota,
        window: options.window,
        retryAfter: result.retryAfter
      });
    }

    next();
  }
};
