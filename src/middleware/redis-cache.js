// Redis Cache Middleware with Advanced Features
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// Try to load Redis
let redis = null;
let redisReady = false;

const initRedis = async () => {
  try {
    const Redis = (await import('redis')).default;
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = Redis.createClient({ url });
    
    redis.on('error', (err) => {
      logger.error('Redis error:', err.message);
      redisReady = false;
    });
    
    redis.on('connect', () => {
      logger.info('Redis connected');
      redisReady = true;
    });
    
    await redis.connect();
    return true;
  } catch (err) {
    logger.warn('Redis not available:', err.message);
    return false;
  }
};

// In-memory fallback cache
const memoryCache = new Map();

// Configuration
const DEFAULT_OPTIONS = {
  ttl: 300, // 5 minutes default
  prefix: 'apix:cache:',
  enableRedis: true,
  compression: true,
  staleWhileRevalidate: false,
  staleTtl: 60
};

// Generate cache key
const generateKey = (options, req) => {
  const parts = [
    options.prefix,
    req.method,
    req.path,
    JSON.stringify(req.query)
  ];
  
  if (req.user?.id) {
    parts.push(req.user.id);
  }
  
  return crypto.createHash('md5').update(parts.join(':')).digest('hex');
};

// Compress data
const compress = async (data) => {
  if (!redis) return JSON.stringify(data);
  
  try {
    const zlib = await import('zlib');
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
    return compressed.toString('base64');
  } catch {
    return JSON.stringify(data);
  }
};

// Decompress data
const decompress = async (data) => {
  try {
    // Try to detect if compressed (base64 encoded gzip)
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > 10) {
      const zlib = await import('zlib');
      const decompressed = zlib.gunzipSync(buffer);
      return JSON.parse(decompressed.toString());
    }
  } catch {}
  
  return typeof data === 'string' ? JSON.parse(data) : data;
};

// Get from cache
const get = async (key) => {
  if (redisReady && redis) {
    try {
      const data = await redis.get(key);
      if (data) {
        return await decompress(data);
      }
    } catch (err) {
      logger.error('Redis get error:', err.message);
    }
  }
  
  // Fallback to memory
  const record = memoryCache.get(key);
  if (record && Date.now() < record.expiresAt) {
    return record.data;
  }
  
  return null;
};

// Set cache
const set = async (key, data, ttl) => {
  const serialized = await compress(data);
  
  if (redisReady && redis) {
    try {
      await redis.setEx(key, ttl, serialized);
    } catch (err) {
      logger.error('Redis set error:', err.message);
    }
  }
  
  // Also set in memory as fallback
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttl * 1000,
    createdAt: Date.now()
  });
};

// Delete from cache
const del = async (key) => {
  if (redisReady && redis) {
    try {
      await redis.del(key);
    } catch (err) {
      logger.error('Redis del error:', err.message);
    }
  }
  
  memoryCache.delete(key);
};

// Create Redis cache middleware
export const redisCache = (options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip if disabled
    if (!config.enableRedis && !redisReady) {
      return next();
    }

    const cacheKey = generateKey(config, req);

    // Try to get from cache
    const cached = await get(cacheKey);
    
    if (cached) {
      logger.debug(`Cache HIT: ${cacheKey}`);
      
      // Check if stale
      const record = memoryCache.get(cacheKey);
      const isStale = record && (Date.now() > record.expiresAt - config.staleTtl * 1000);
      
      res.set('X-Cache', isStale ? 'STALE' : 'HIT');
      
      // Return cached response
      if (!isStale || !config.staleWhileRevalidate) {
        return res.status(200).json(cached);
      }
      
      // Stale-while-revalidate: return cached + refresh in background
      if (config.staleWhileRevalidate && redis) {
        // Fire and forget - will update cache
        next();
        
        // Add to queue for background refresh
        return res.status(200).json(cached);
      }
    }

    logger.debug(`Cache MISS: ${cacheKey}`);
    res.set('X-Cache', 'MISS');

    // Capture response
    const originalJson = res.json.bind(res);
    
    res.json = async (data) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300 && data) {
        await set(cacheKey, data, config.ttl);
        logger.debug(`Cache SET: ${cacheKey}`);
      }
      
      originalJson(data);
    };

    next();
  };
};

// Cache invalidation patterns
export const invalidateCache = async (pattern) => {
  if (redisReady && redis) {
    try {
      const keys = await redis.keys(`${DEFAULT_OPTIONS.prefix}*${pattern}*`);
      if (keys.length > 0) {
        await redis.del(keys);
        logger.info(`Invalidated ${keys.length} cache entries matching: ${pattern}`);
      }
    } catch (err) {
      logger.error('Cache invalidation error:', err.message);
    }
  }
  
  // Also clear matching memory cache
  for (const key of memoryCache.keys()) {
    if (key.includes(pattern)) {
      memoryCache.delete(key);
    }
  }
};

// Get cache stats
export const getCacheStats = async () => {
  let redisStats = null;
  
  if (redisReady && redis) {
    try {
      const info = await redis.info('stats');
      const memory = await redis.info('memory');
      redisStats = { connected: true, info, memory };
    } catch (err) {
      redisStats = { connected: false, error: err.message };
    }
  }
  
  return {
    redis: redisStats,
    memory: {
      size: memoryCache.size,
      entries: Array.from(memoryCache.keys()).slice(0, 10)
    },
    config: DEFAULT_OPTIONS
  };
};

// Clear all cache
export const clearCache = async () => {
  if (redisReady && redis) {
    try {
      const keys = await redis.keys(`${DEFAULT_OPTIONS.prefix}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } catch (err) {
      logger.error('Clear cache error:', err.message);
    }
  }
  
  memoryCache.clear();
  logger.info('Cache cleared');
};

// Initialize Redis
initRedis();

export default {
  redisCache,
  invalidateCache,
  getCacheStats,
  clearCache,
  initRedis
};
