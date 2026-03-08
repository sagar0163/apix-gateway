// Performance Optimization Middleware
import { logger } from '../utils/logger.js';

// In-memory cache for responses
const responseCache = new Map();

// Cache configuration
const cacheConfig = {
  maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000'),
  maxAge: parseInt(process.env.CACHE_TTL || '60000'), // 1 minute default
  compressionThreshold: parseInt(process.env.CACHE_COMPRESS_THRESHOLD || '1024')
};

// Gzip compression (lazy loaded)
let zlib;
const getZlib = () => {
  if (!zlib) zlib = require('zlib');
  return zlib;
};

// Generate cache key
const generateCacheKey = (req) => {
  return `${req.method}:${req.path}:${JSON.stringify(req.query)}`;
};

// Compress data
const compress = (data) => {
  const z = getZlib();
  return z.gzipSync(Buffer.from(JSON.stringify(data)));
};

// Decompress data
const decompress = (buffer) => {
  const z = getZlib();
  return JSON.parse(z.gunzipSync(buffer).toString());
};

// Response compression middleware
export const compression = (options = {}) => {
  const {
    threshold = 1024,
    level = 6,
    filter
  } = options;

  return (req, res, next) => {
    // Don't compress if disabled
    if (process.env.ENABLE_COMPRESSION === 'false') {
      return next();
    }

    // Check if client accepts compression
    const accept = req.headers['accept-encoding'] || '';
    if (!accept.includes('gzip') && !accept.includes('deflate')) {
      return next();
    }

    // Skip for certain content types
    if (filter && !filter(req)) {
      return next();
    }

    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (data) => {
      const jsonStr = JSON.stringify(data);
      
      // Only compress if above threshold
      if (jsonStr.length > threshold) {
        const compressed = compress(jsonStr);
        
        res.set('Content-Encoding', 'gzip');
        res.set('Vary', 'Accept-Encoding');
        
        // Add compression ratio header
        const ratio = ((compressed.length / jsonStr.length) * 100).toFixed(1);
        res.set('X-Compression-Ratio', `${ratio}%`);
        
        originalSend(compressed);
      } else {
        originalSend(jsonStr);
      }
    };

    next();
  };
};

// Response caching middleware
export const responseCacheMiddleware = (options = {}) => {
  const {
    ttl = cacheConfig.maxAge,
    cacheKey,
    shouldCache = () => true,
    excludeStatuses = [404, 500, 502, 503, 504]
  } = options;

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Check if should cache
    if (!shouldCache(req)) {
      return next();
    }

    const key = cacheKey ? cacheKey(req) : generateCacheKey(req);
    const cached = responseCache.get(key);

    if (cached) {
      const { data, timestamp, headers } = cached;
      const age = Date.now() - timestamp;

      if (age < ttl) {
        // Set cache headers
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Age', Math.floor(age / 1000).toString());
        
        // Set cached headers
        if (headers) {
          Object.entries(headers).forEach(([k, v]) => res.set(k, v));
        }

        logger.debug(`Cache hit: ${key}`);
        return res.status(200).json(data);
      } else {
        // Expired
        responseCache.delete(key);
      }
    }

    // Store original json
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (data) => {
      // Don't cache error responses
      if (!excludeStatuses.includes(res.statusCode)) {
        const cacheData = {
          data,
          timestamp: Date.now(),
          headers: {
            'Content-Type': 'application/json'
          }
        };

        // Manage cache size
        if (responseCache.size >= cacheConfig.maxSize) {
          // Remove oldest entry
          const firstKey = responseCache.keys().next().value;
          responseCache.delete(firstKey);
        }

        responseCache.set(key, cacheData);
        res.set('X-Cache', 'MISS');
      }

      originalJson(data);
    };

    next();
  };
};

// Request deduplication - prevent duplicate requests
const inFlightRequests = new Map();

export const requestDeduplication = (options = {}) => {
  const { ttl = 5000 } = options;

  return (req, res, next) => {
    const key = `${req.method}:${req.originalUrl}`;
    const inFlight = inFlightRequests.get(key);

    if (inFlight) {
      logger.debug(`Deduplicating request: ${key}`);
      // Wait for existing request
      inFlight.then((response) => {
        // Clone and send cached response
        res.status(response.status);
        Object.entries(response.headers).forEach(([k, v]) => res.set(k, v));
        res.json(response.data);
      }).catch(() => {
        // Original request failed, continue
        next();
      });
    } else {
      // Store promise for deduplication
      const promise = new Promise((resolve, reject) => {
        // Wrap res.json to capture response
        const originalJson = res.json.bind(res);
        res.json = (data) => {
          resolve({
            status: res.statusCode,
            headers: res.getHeaders(),
            data
          });
          originalJson(data);
        };
        
        res.on('error', reject);
      });

      inFlightRequests.set(key, promise);

      // Clean up after ttl
      setTimeout(() => {
        inFlightRequests.delete(key);
      }, ttl);
    }

    next();
  };
};

// Connection pooling info
export const connectionPoolStats = () => {
  return {
    cache: {
      size: responseCache.size,
      maxSize: cacheConfig.maxSize,
      hitRate: 'N/A' // Would need to track hits/misses
    },
    inFlight: inFlightRequests.size
  };
};

// Clear cache
export const clearCache = () => {
  responseCache.clear();
  logger.info('Response cache cleared');
};

export default {
  compression,
  responseCacheMiddleware,
  requestDeduplication,
  connectionPoolStats,
  clearCache
};
