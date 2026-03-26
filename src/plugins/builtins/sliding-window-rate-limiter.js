// Sliding Window Rate Limiter Plugin with Redis
import { logger } from '../../utils/logger.js';
import { redisManager } from '../../utils/redis.js';

const DEFAULT_OPTIONS = {
  windowSize: 60,
  maxRequests: 100,
  keyPrefix: 'swrl:',
  redisKeyTTL: 120,
  fallbackToInMemory: true,
  blockOnExceeded: false,
  identifierHeader: 'x-forwarded-for',
  message: 'Too Many Requests',
  retryAfter: 60
};

const inMemoryStore = new Map();

export default {
  name: 'sliding-window-rate-limiter',
  version: '2.0.0',
  description: 'Sliding window rate limiter with Redis backend',
  defaultOptions: DEFAULT_OPTIONS,

  _getRedisKey(key, windowId) {
    return `${this.options.keyPrefix}${key}:${windowId}`;
  },

  _getCurrentWindowId() {
    return Math.floor(Date.now() / 1000 / this.options.windowSize);
  },

  _getPreviousWindowId() {
    return this._getCurrentWindowId() - 1;
  },

  async _getSlidingWindowCount(clientKey) {
    const currentWindow = this._getCurrentWindowId();
    const previousWindow = this._getPreviousWindowId();
    const currentKey = this._getRedisKey(clientKey, currentWindow);
    const previousKey = this._getRedisKey(clientKey, previousWindow);

    try {
      const script = `
        local currentCount = tonumber(redis.call('GET', KEYS[1]) or '0')
        local previousCount = tonumber(redis.call('GET', KEYS[2]) or '0')
        local windowSize = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])
        local currentWeight = 1.0
        local previousWeight = 0.0
        if currentCount > 0 then
          local currentAge = now % windowSize
          currentWeight = 1.0 - (currentAge / windowSize)
          previousWeight = currentAge / windowSize
        end
        local estimate = (currentCount * currentWeight) + (previousCount * previousWeight)
        return {currentCount, previousCount, estimate}
      `;

      const result = await redisManager.getClient()?.eval(script, 2, currentKey, previousKey, this.options.windowSize, Date.now());

      if (result) {
        return {
          current: parseInt(result[0]) || 0,
          previous: parseInt(result[1]) || 0,
          estimate: parseFloat(result[2]) || 0
        };
      }
    } catch (err) {
      logger.error('Sliding window calculation error:', err.message);
    }

    const current = await redisManager.get(clientKey) || 0;
    return { current: parseInt(current), previous: 0, estimate: parseInt(current) };
  },

  async _incrementRedis(clientKey) {
    const currentWindow = this._getCurrentWindowId();
    const key = this._getRedisKey(clientKey, currentWindow);
    const count = await redisManager.increment(key, this.options.redisKeyTTL);
    return count;
  },

  _incrementInMemory(key) {
    const now = Date.now();
    const windowMs = (this.options?.windowSize || DEFAULT_OPTIONS.windowSize) * 1000;

    let record = inMemoryStore.get(key);

    if (!record || now - record.windowStart > windowMs) {
      record = {
        count: 0,
        windowStart: now
      };
      inMemoryStore.set(key, record);
    }

    record.count++;

    // Periodic cleanup
    if (inMemoryStore.size > 10000) {
      for (const [k, v] of inMemoryStore.entries()) {
        if (now - v.windowStart > windowMs * 2) {
          inMemoryStore.delete(k);
        }
      }
    }

    return {
      count: record.count,
      remaining: Math.max(0, (this.options?.maxRequests || DEFAULT_OPTIONS.maxRequests) - record.count),
      resetTime: record.windowStart + windowMs
    };
  },

  async checkLimit(req, options) {
    const clientKey = req.headers[options.identifierHeader] || req.ip || 'unknown';
    const useRedis = redisManager.isConnected && options.fallbackToInMemory;

    let result;

    if (useRedis) {
      try {
        const windowCount = await this._getSlidingWindowCount(clientKey);
        const count = await this._incrementRedis(clientKey);
        result = {
          count,
          remaining: Math.max(0, options.maxRequests - count),
          resetTime: (this._getCurrentWindowId() + 1) * options.windowSize * 1000
        };
      } catch (err) {
        logger.warn('Redis error, falling back to in-memory:', err.message);
        result = this._incrementInMemory(clientKey);
      }
    } else {
      result = this._incrementInMemory(clientKey);
    }

    return result;
  },

  async handle(req, res, next) {
    const options = { ...DEFAULT_OPTIONS, ...this.options };

    const result = await this.checkLimit(req, options);

    res.set('X-RateLimit-Limit', options.maxRequests);
    res.set('X-RateLimit-Remaining', result.remaining);
    res.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    if (result.count > options.maxRequests) {
      if (options.blockOnExceeded) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: options.message,
          retryAfter: options.retryAfter
        });
      } else {
        logger.info(`Rate limit warning for ${req.ip}: ${result.count} requests`);
      }
    }

    next();
  },

  handler: async (req, res, next) => {
    try {
      await this.handle(req, res, next);
    } catch (err) {
      logger.error('Rate limiter error:', err.message);
      next();
    }
  }
};
