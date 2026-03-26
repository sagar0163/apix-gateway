// Advanced Rate Limiter with Redis support and sliding window
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// In-memory store
const memoryStore = new Map();

// Redis client (optional)
let redisClient = null;

const initRedis = async () => {
  try {
    const Redis = (await import('redis')).default;
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = Redis.createClient({ url });
    await redisClient.connect();
    logger.info('Redis rate limiter connected');
    return true;
  } catch (err) {
    logger.warn('Redis not available, using in-memory store');
    return false;
  }
};

// Rate limit configurations
const createRateLimiter = (options = {}) => {
  const {
    windowMs = 60000,
    maxRequests = 100,
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    redis = false,
    blockDuration = 60000,
    skip = () => false
  } = options;

  return async (req, res, next) => {
    // Skip if configured
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    req._rateLimitTimestamp = now; // Store for skip logic
    const windowStart = now - windowMs;

    try {
      let currentCount;
      let isBlocked = false;

      if (redis && redisClient) {
        // Redis-based sliding window
        const redisKey = `ratelimit:${key}`;
        
        // Remove old entries
        await redisClient.zRemRangeByScore(redisKey, 0, windowStart);
        
        // Count current requests
        currentCount = await redisClient.zCard(redisKey);
        
        // Check if blocked
        const blockedKey = `ratelimit:blocked:${key}`;
        const blockedUntil = await redisClient.get(blockedKey);
        
        if (blockedUntil && parseInt(blockedUntil) > now) {
          isBlocked = true;
          const retryAfter = Math.ceil((parseInt(blockedUntil) - now) / 1000);
          res.set('Retry-After', retryAfter.toString());
        } else {
          // Add current request
          await redisClient.zAdd(redisKey, { score: now, value: now.toString() });
          await redisClient.expire(redisKey, Math.ceil(windowMs / 1000));
        }
      } else {
        // In-memory sliding window
        const record = memoryStore.get(key);
        
        if (!record) {
          memoryStore.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
          currentCount = 1;
        } else if (now > record.windowStart + windowMs) {
          record.count = 1;
          record.windowStart = now;
          record.blockedUntil = 0;
          currentCount = 1;
        } else if (record.blockedUntil > now) {
          isBlocked = true;
          currentCount = record.count;
        } else {
          record.count++;
          currentCount = record.count;
        }
      }

      // Set rate limit headers
      res.set('X-RateLimit-Limit', maxRequests.toString());
      res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount).toString());
      res.set('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000).toString());

      // Check if exceeded
      if (currentCount > maxRequests || isBlocked) {
        // Block the IP
        if (!redis || !redisClient) {
          const record = memoryStore.get(key);
          if (record) {
            record.blockedUntil = now + blockDuration;
          }
        } else {
          const blockedKey = `ratelimit:blocked:${key}`;
          await redisClient.set(blockedKey, (now + blockDuration).toString(), { EX: Math.ceil(blockDuration / 1000) });
        }

        logger.warn(`Rate limit exceeded for ${key}: ${currentCount}/${maxRequests}`);

        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${Math.ceil(blockDuration / 1000)} seconds`,
          retryAfter: Math.ceil(blockDuration / 1000),
          limit: maxRequests,
          remaining: 0,
          reset: Math.ceil((now + windowMs) / 1000)
        });
      }

      // Track successful/failed requests
      res.on('finish', async () => {
        const shouldSkip = (skipSuccessfulRequests && res.statusCode < 400) ||
                         (skipFailedRequests && res.statusCode >= 400);
        
        if (shouldSkip) {
          if (redis && redisClient) {
            const redisKey = `ratelimit:${key}`;
            const timestamp = req._rateLimitTimestamp;
            if (timestamp) {
              await redisClient.zRem(redisKey, timestamp.toString());
            }
          } else {
            const record = memoryStore.get(key);
            if (record) record.count = Math.max(0, record.count - 1);
          }
        }
      });

      next();
    } catch (err) {
      logger.error('Rate limiter error:', err);
      // Fail open - allow request if rate limiter fails
      next();
    }
  };
};

// Cleanup old entries periodically
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.windowStart + 60000 * 2) {
      memoryStore.delete(key);
    }
  }
}, 60000);

process.on('SIGTERM', () => {
  clearInterval(cleanupInterval);
});

export const rateLimiter = {
  create: createRateLimiter,
  initRedis,
  middleware: createRateLimiter()
};

export default rateLimiter;


// Hardening Audit: v1.2.0 - Verified by Sagar Jadhav
