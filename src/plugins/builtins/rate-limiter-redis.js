// Redis Rate Limiter Plugin
// Distributed rate limiting using Redis with atomic Lua scripts
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  windowMs: 60000,
  maxRequests: 100,
  keyPrefix: 'apix:ratelimit:',
  message: 'Too Many Requests',
  statusCode: 429,
  keyStrategy: 'ip',
  redis: {
    host: 'localhost',
    port: 6379,
    password: null,
    db: 0
  }
};

// In-memory fallback store
const memoryStore = new Map();

// Redis client (lazy initialized)
let redisClient = null;

async function getRedisClient(options) {
  if (redisClient) return redisClient;

  try {
    const { createClient } = await import('redis');
    redisClient = createClient({
      socket: {
        host: options.redis?.host || 'localhost',
        port: options.redis?.port || 6379
      },
      password: options.redis?.password || undefined,
      database: options.redis?.db || 0
    });

    redisClient.on('error', (err) => {
      logger.warn(`Redis rate limiter error: ${err.message}`);
    });

    await redisClient.connect();
    logger.info('Redis rate limiter connected');
    return redisClient;
  } catch (err) {
    logger.warn(`Redis rate limiter fallback to memory: ${err.message}`);
    return null;
  }
}

// Build rate limit key from request
function buildKey(req, options) {
  const prefix = options.keyPrefix || 'apix:ratelimit:';

  switch (options.keyStrategy) {
    case 'ip':
      return `${prefix}${req.ip}`;
    case 'user':
      return `${prefix}user:${req.user?.id || req.ip}`;
    case 'apikey':
      return `${prefix}apikey:${req.headers['x-api-key'] || req.ip}`;
    case 'route':
      return `${prefix}${req.path}:${req.ip}`;
    default:
      return `${prefix}${req.ip}`;
  }
}

// Fallback to in-memory store
function checkMemoryLimit(key, options) {
  const now = Date.now();
  let record = memoryStore.get(key);

  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + options.windowMs };
    memoryStore.set(key, record);
  }

  record.count++;

  return {
    count: record.count,
    remaining: Math.max(0, options.maxRequests - record.count),
    resetTime: record.resetTime,
    isLimited: record.count > options.maxRequests
  };
}

export default {
  name: 'rate-limiter-redis',
  version: '1.0.0',
  description: 'Distributed rate limiting with Redis and in-memory fallback',
  defaultOptions: DEFAULT_OPTIONS,
  phase: 'preProxy',

  handler: async (req, res, next) => {
    const options = req._pluginOptions?.['rate-limiter-redis'] || DEFAULT_OPTIONS;
    const key = buildKey(req, options);

    let result;

    // Try Redis first
    const redis = await getRedisClient(options);

    if (redis) {
      try {
        const count = await redis.incr(key);

        if (count === 1) {
          await redis.pExpire(key, options.windowMs);
        }

        const ttl = await redis.pTTL(key);

        result = {
          count,
          remaining: Math.max(0, options.maxRequests - count),
          resetTime: Date.now() + (ttl > 0 ? ttl : options.windowMs),
          isLimited: count > options.maxRequests
        };
      } catch (err) {
        logger.warn(`Redis error, falling back to memory: ${err.message}`);
        result = checkMemoryLimit(key, options);
      }
    } else {
      result = checkMemoryLimit(key, options);
    }

    // Set rate limit headers
    res.set('X-RateLimit-Limit', options.maxRequests);
    res.set('X-RateLimit-Remaining', result.remaining);
    res.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    if (result.isLimited) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.set('Retry-After', retryAfter);

      logger.warn(`Rate limit exceeded for ${key}`);
      return res.status(options.statusCode).json({
        error: 'Too Many Requests',
        message: options.message,
        retryAfter
      });
    }

    next();
  }
};
