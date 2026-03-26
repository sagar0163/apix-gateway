// Sliding Window Rate Limiter Plugin with Redis
import { logger } from '../../utils/logger.js';
import { redisManager } from '../../utils/redis.js';

const DEFAULT_OPTIONS = {
  windowSize: 60,        // Window size in seconds
  maxRequests: 100,       // Max requests per window
  keyPrefix: 'swrl:',     // Redis key prefix
  redisKeyTTL: 120,       // TTL for Redis keys (2x window for sliding)
  fallbackToInMemory: true, // Use in-memory if Redis fails
  blockOnExceeded: false,  // Return 429 immediately vs queue
  identifierHeader: 'x-forwarded-for', // Custom header for client ID
  message: 'Too Many Requests',
  retryAfter: 60
};

// In-memory fallback store (for Redis unavailability)
const inMemoryStore = new Map();

export default {
  name: 'sliding-window-rate-limiter',
  version: '2.0.0',
  description: 'Sliding window rate limiter with Redis backend',
  defaultOptions: DEFAULT_OPTIONS,

  // Get Redis key for client
  _getRedisKey(key, windowId) {
    return `${this.options.keyPrefix}${key}:${windowId}`;
  },

  // Calculate current window ID
  _getCurrentWindowId() {
    return Math.floor(Date.now() / 1000 / this.options.windowSize);
  },

  // Get previous window ID (for sliding calculation)
  _getPreviousWindowId() {
    return this._getCurrentWindowId() - 1;
  },

  // Calculate sliding window count using Redis Lua script
  async _getSlidingWindowCount(clientKey) {
    const currentWindow = this._getCurrentWindowId();
    const previousWindow = this._getPreviousWindowId();
    const windowSize = this.options.windowSize;
    
    const currentKey = this._getRedisKey(clientKey, currentWindow);
    const previousKey = this._getRedisKey(clientKey, previousWindow);

    try {
      // Use Lua script for atomic sliding window calculation
      const script = `
        local currentCount = tonumber(redis.call('GET', KEYS[1]) or '0')
        local previousCount = tonumber(redis.call('GET', KEYS[2]) or '0')
        local currentExpiry = tonumber(redis.call('TTL', KEYS[1]))
        local previousExpiry = tonumber(redis.call('TTL', KEYS[2]))
        
        -- Calculate sliding window estimate
        local currentWeight = currentExpiry / ${windowSize}
        local previousWeight = 1 - currentWeight
        local estimate = (currentCount * currentWeight) + (previousCount * previousWeight)
        
        return {currentCount, previousCount, estimate}
      `;

      const result = await redisManager.getClient()?.eval(script, 2, currentKey, previousKey);
      
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

    // Fallback to simple current window count
    const current = await redisManager.get(clientKey) || 0;
    return { current: parseInt(current), previous: 0, estimate: parseInt(current) };
  },

  // Increment counter in Redis
  async _incrementRedis(clientKey) {
    const currentWindow = this._getCurrentWindowId();
    const key = this._getRedisKey(clientKey, currentWindow);
    
    const count = await redisManager.increment(key, this.options.redisKeyTTL);
    return count;
  },

  // In-memory fallback (non-blocking)
  _checkInMemory(key) {
    const now = Date.now();
    const windowMs = this.options.windowSize * 1000;
    
    let record = inMemoryStore.get(key);
    
    if (!record || now - record.windowStart > windowMs) {
      record = {
        count: 0,
        windowStart: now
      };
      inMemoryStore.set(key, record);
    }
    
    record.count++;
    
    // Cleanup old entries periodically
    if (inMemoryStore.size > 10000) {
      for (const [k, v] of inMemoryStore.entries()) {
        if (now - v.windowStart > windowMs * 2) {
          inMemoryStore.delete(k);
        }
      }
    }
    
    return {
      count: record.count,
      remaining: Math.max(0, this.options.maxRequests - record.count),
      resetTime: record.windowStart + windowMs
    };
  }

  // In-memory increment
  _incrementInMemory(key) {
    const now = Date.now();
    const windowMs = this.options.windowSize * 1000;
    
    let record = inMemoryStore.get(key);
    
    if (!record || now - record.windowStart > windowMs) {
      record = {
        count: 0,
        windowStart: now
      };
    }
    
    record.count++;
    inMemoryStore.set(key, record);
    
    return {
      count: record.count,
      remaining: Math.max(0, this.options.maxRequests - record.count),
      resetTime: record.windowStart + windowMs
    };
  },

  // Main handler
  async handle(req, res, next) {
    const options = this.options;
    
    // Get client identifier
    const identifierHeader = options.identifierHeader;
    const clientKey = req.headers[identifierHeader] || req.ip || req.headers['x-real-ip'] || 'unknown';
    
    let result;
    let isFallback = false;

    // Try Redis first
    if (redisManager.isReady()) {
      try {
        // Increment counter
        const count = await this._incrementRedis(clientKey);
        
        if (count !== null) {
          result = {
            count,
            remaining: Math.max(0, options.maxRequests - count),
            resetTime: Math.ceil((this._getCurrentWindowId() + 1) * options.windowSize * 1000)
          };
        } else {
          isFallback = true;
        }
      } catch (err) {
        logger.error('Redis rate limit error:', err.message);
        isFallback = true;
      }
    } else {
      isFallback = true;
    }

    // Fallback to in-memory if Redis unavailable
    if (isFallback) {
      if (options.fallbackToInMemory) {
        result = this._incrementInMemory(clientKey);
      } else {
        // If no fallback allowed, pass through
        return next();
      }
    }

    // Set rate limit headers
    res.set('X-RateLimit-Limit', options.maxRequests);
    res.set('X-RateLimit-Remaining', result.remaining);
    res.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    // Check if limit exceeded
    if (result.count > options.maxRequests) {
      logger.warn(`Sliding window rate limit exceeded for ${clientKey}: ${result.count}/${options.maxRequests}`);
      
      if (options.blockOnExceeded) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: options.message,
          retryAfter: options.retryAfter,
          limit: options.maxRequests,
          window: options.windowSize
        });
      }
      
      // Non-blocking: allow but log
      logger.info(`Rate limit warning for ${clientKey}: ${result.count} requests`);
    }

    // Non-blocking: always call next
    next();
  },

  // Handler factory (for plugin manager)
  handler: async (req, res, next) => {
    // Store options for this instance
    const pluginInstance = req._pluginOptions?.['sliding-window-rate-limiter'] || DEFAULT_OPTIONS;
    
    const self = this;
    
    // Wrapper to make it async-compatible
    const asyncNext = async () => {
      return new Promise(async (resolve) => {
        try {
          await self.handle.call(self, req, res, () => resolve());
        } catch (err) {
          logger.error('Rate limiter error:', err.message);
          resolve(); // Continue on error
        }
      });
    };
    
    return asyncNext();
  }
};
