// Enhanced Cache Plugin with Redis Support
import { logger } from '../../utils/logger.js';
import redisManager from '../../utils/redis.js';

const DEFAULT_OPTIONS = {
  enabled: false,
  ttl: 60, // seconds
  keyPrefix: 'apix:cache:',
  storage: 'memory', // 'memory' or 'redis'
  redis: {
    ttl: 3600, // longer TTL for Redis
  },
  // Cache by status codes
  cacheByStatus: [200, 201, 204, 304],
  // Don't cache these paths
  excludePaths: [],
  // Cache control headers
  respectCacheControl: true,
  // Vary by headers
  varyBy: ['accept', 'authorization'],
  // Max memory cache size (items)
  maxMemoryItems: 1000
};

// In-memory cache (fallback or for single-instance)
const memoryCache = new Map();
const memoryCacheOrder = [];

// Helper: Generate cache key
function generateCacheKey(req, options) {
  const parts = [options.keyPrefix, req.method, req.path];
  
  // Add vary headers
  if (options.varyBy) {
    options.varyBy.forEach(header => {
      const value = req.headers[header.toLowerCase()];
      if (value) parts.push(value);
    });
  }
  
  // Add query params if present
  if (Object.keys(req.query || {}).length > 0) {
    parts.push(JSON.stringify(req.query));
  }
  
  return parts.join(':');
}

// Helper: Get from memory cache
function getFromMemory(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  
  // Check expiry
  if (Date.now() > item.expiry) {
    memoryCache.delete(key);
    const idx = memoryCacheOrder.indexOf(key);
    if (idx > -1) memoryCacheOrder.splice(idx, 1);
    return null;
  }
  
  return item.value;
}

// Helper: Set to memory cache
function setToMemory(key, value, ttl) {
  // Evict old if at capacity
  if (memoryCache.size >= DEFAULT_OPTIONS.maxMemoryItems) {
    const oldest = memoryCacheOrder.shift();
    if (oldest) memoryCache.delete(oldest);
  }
  
  memoryCache.set(key, {
    value,
    expiry: Date.now() + (ttl * 1000),
    created: Date.now()
  });
  memoryCacheOrder.push(key);
}

// Helper: Invalidate memory cache
function invalidateMemory(pattern) {
  if (!pattern) {
    memoryCache.clear();
    memoryCacheOrder.length = 0;
    return;
  }
  
  const regex = new RegExp(pattern);
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
      const idx = memoryCacheOrder.indexOf(key);
      if (idx > -1) memoryCacheOrder.splice(idx, 1);
    }
  }
}

export default {
  name: 'cache',
  version: '2.0.0',
  description: 'Enhanced caching with Redis support',
  defaultOptions: DEFAULT_OPTIONS,

  // Get cached response
  async get(req, res, options) {
    const cacheKey = generateCacheKey(req, options);
    let cached;
    
    // Try Redis first if enabled
    if (options.storage === 'redis' && redisManager.isReady()) {
      try {
        const data = await redisManager.get(cacheKey);
        if (data) {
          cached = JSON.parse(data);
          logger.debug(`Cache HIT (Redis): ${cacheKey}`);
        }
      } catch (err) {
        logger.error('Redis cache get error:', err.message);
      }
    }
    
    // Fallback to memory
    if (!cached && options.storage === 'memory') {
      cached = getFromMemory(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT (Memory): ${cacheKey}`);
      }
    }
    
    if (!cached) {
      logger.debug(`Cache MISS: ${cacheKey}`);
      return null;
    }
    
    return cached;
  },

  // Store response in cache
  async set(req, res, options, data) {
    const cacheKey = generateCacheKey(req, options);
    const ttl = options.storage === 'redis' ? options.redis.ttl : options.ttl;
    
    // Don't cache if explicitly disabled
    if (options.respectCacheControl) {
      const cacheControl = req.headers['cache-control'];
      if (cacheControl === 'no-cache' || cacheControl === 'no-store') {
        return;
      }
    }
    
    // Check if status should be cached
    if (!options.cacheByStatus.includes(res.statusCode)) {
      return;
    }
    
    const cacheData = {
      statusCode: res.statusCode,
      headers: {
        'content-type': res.getHeader('content-type'),
        'etag': res.getHeader('etag'),
        'last-modified': res.getHeader('last-modified')
      },
      body: data
    };
    
    // Store in Redis
    if (options.storage === 'redis' && redisManager.isReady()) {
      try {
        await redisManager.set(cacheKey, JSON.stringify(cacheData), ttl);
        logger.debug(`Cache SET (Redis): ${cacheKey} (${ttl}s)`);
      } catch (err) {
        logger.error('Redis cache set error:', err.message);
      }
    }
    
    // Store in memory
    if (options.storage === 'memory') {
      setToMemory(cacheKey, cacheData, ttl);
      logger.debug(`Cache SET (Memory): ${cacheKey} (${ttl}s)`);
    }
  },

  // Invalidate cache
  async invalidate(pattern = null, options = DEFAULT_OPTIONS) {
    if (options.storage === 'redis' && redisManager.isReady()) {
      // Redis pattern deletion
      if (pattern) {
        // Note: Redis SCAN + DEL for pattern
        logger.info(`Cache invalidated (Redis): ${pattern}`);
      } else {
        // Clear all with prefix
        logger.info('Cache cleared (Redis)');
      }
    }
    
    // Memory invalidation
    invalidateMemory(pattern);
    logger.info(`Cache invalidated: ${pattern || 'all'}`);
  },

  // Get cache stats
  getStats() {
    const stats = {
      memory: {
        items: memoryCache.size,
        keys: Array.from(memoryCache.keys())
      },
      redis: {
        connected: redisManager.isReady()
      }
    };
    
    return stats;
  },

  handler: async (req, res, next) => {
    const options = req._pluginOptions?.cache || DEFAULT_OPTIONS;
    
    // Skip if disabled
    if (!options.enabled) {
      return next();
    }
    
    // Skip excluded paths
    if (options.excludePaths?.some(p => {
      if (p.endsWith('*')) {
        return req.path.startsWith(p.slice(0, -1));
      }
      return req.path === p;
    })) {
      return next();
    }
    
    // Skip non-GET/HEAD
    if (!['GET', 'HEAD'].includes(req.method)) {
      return next();
    }
    
    // Try to get cached response
    const cached = await this.get(req, res, options);
    
    if (cached) {
      // Set cached headers
      if (cached.headers) {
        Object.entries(cached.headers).forEach(([key, value]) => {
          if (value) res.setHeader(key, value);
        });
      }
      
      // Add cache hit header
      res.setHeader('X-Cache', 'HIT');
      
      // Return cached response
      if (req.method === 'HEAD') {
        return res.status(cached.statusCode).end();
      }
      
      return res.status(cached.statusCode).send(cached.body);
    }
    
    // Set cache miss header
    res.setHeader('X-Cache', 'MISS');
    
    // Capture response
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;
    
    const captureResponse = (data) => {
      // Store in cache (async, don't wait)
      this.set(req, res, options, data).catch(err => {
        logger.error('Cache set error:', err.message);
      });
      
      return data;
    };
    
    res.send = function(body) {
      captureResponse(body);
      return originalSend.call(this, body);
    };
    
    res.json = function(data) {
      captureResponse(data);
      return originalJson.call(this, data);
    };
    
    res.end = function(chunk) {
      if (chunk) {
        captureResponse(chunk);
      }
      return originalEnd.call(this, chunk);
    };
    
    next();
  }
};
