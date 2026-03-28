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
  algorithm: 'fixed', // 'fixed' = INCR+EXPIRE, 'sliding' = sorted sets
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

// Lua script for atomic INCR + EXPIRE
// Returns [count, ttl_ms] in a single atomic operation
// This prevents race condition between INCR and EXPIRE
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_requests = tonumber(ARGV[2])

-- Atomic increment
local count = redis.call('INCR', key)

-- Set expiry only on first request (count == 1)
if count == 1 then
  redis.call('PEXPIRE', key, window_ms)
end

-- Get remaining TTL
local ttl = redis.call('PTTL', key)
if ttl < 0 then
  ttl = window_ms
  redis.call('PEXPIRE', key, window_ms)
end

-- Return count and TTL
return {count, ttl}
`;

// Sliding window Lua script using sorted sets
// More accurate rate limiting that doesn't suffer from boundary issues
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local window_start = now - window_ms

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current window
local count = redis.call('ZCARD', key)

-- Check if under limit
if count < max_requests then
  -- Add current request with unique member (timestamp + random)
  local member = tostring(now) .. ':' .. math.random(1000000)
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window_ms)
  count = count + 1
  return {0, count, max_requests - count}
else
  -- Get oldest entry to calculate retry-after
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 0
  if #oldest > 0 then
    retry_after = math.ceil((tonumber(oldest[2]) + window_ms - now) / 1000)
  end
  return {1, count, retry_after}
end
`;

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

    // Try Redis first with atomic Lua script
    const redis = await getRedisClient(options);

    if (redis) {
      try {
        if (options.algorithm === 'sliding') {
          // Sliding window using sorted sets (more accurate)
          const luaResult = await redis.eval(SLIDING_WINDOW_LUA, {
            keys: [key],
            arguments: [String(Date.now()), String(options.windowMs), String(options.maxRequests)]
          });

          const isLimited = luaResult[0] === 1;
          const count = luaResult[1];
          const retryAfter = isLimited ? luaResult[2] : 0;

          result = {
            count,
            remaining: isLimited ? 0 : luaResult[2],
            resetTime: isLimited ? Date.now() + (retryAfter * 1000) : Date.now() + options.windowMs,
            isLimited
          };

          if (isLimited) {
            res.set('Retry-After', retryAfter);
          }
        } else {
          // Fixed window with atomic INCR + EXPIRE via Lua script
          const luaResult = await redis.eval(RATE_LIMIT_LUA, {
            keys: [key],
            arguments: [String(options.windowMs), String(options.maxRequests)]
          });

          const count = luaResult[0];
          const ttl = luaResult[1];

          result = {
            count,
            remaining: Math.max(0, options.maxRequests - count),
            resetTime: Date.now() + ttl,
            isLimited: count > options.maxRequests
          };
        }
      } catch (err) {
        logger.warn(`Redis error, falling back to memory: ${err.message}`);
        result = checkMemoryLimit(key, options);
      }
    } else {
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
