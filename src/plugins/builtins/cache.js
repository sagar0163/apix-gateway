// Response Caching Plugin (Redis)
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const DEFAULT_OPTIONS = {
  cacheBy: 'url', // 'url', 'query', 'header'
  headerName: 'x-cache-key',
  ttl: 60, // seconds
  cacheControl: true,
  storage: 'memory' // 'memory' or 'redis'
};

// In-memory cache
const cache = new Map();

export default {
  name: 'cache',
  version: '1.0.0',
  description: 'Response caching plugin',
  defaultOptions: DEFAULT_OPTIONS,

  // Generate cache key
  generateKey(req, options) {
    if (options.headerName && req.headers[options.headerName]) {
      return req.headers[options.headerName];
    }
    
    let key = req.originalUrl || req.url;
    
    if (options.cacheBy === 'query') {
      const query = JSON.stringify(req.query);
      key = `${req.path}?${query}`;
    } else if (options.cacheBy === 'header') {
      const headerValue = req.headers['x-user-id'] || req.headers['x-api-key'] || '';
      key = `${req.path}:${headerValue}`;
    }
    
    return crypto.createHash('md5').update(key).digest('hex');
  },

  // Get from cache
  get(key) {
    const record = cache.get(key);
    if (!record) return null;
    
    if (Date.now() > record.expiresAt) {
      cache.delete(key);
      return null;
    }
    
    record.hits = (record.hits || 0) + 1;
    return record;
  },

  // Set cache
  set(key, value, ttl) {
    cache.set(key, {
      data: value,
      expiresAt: Date.now() + (ttl * 1000),
      createdAt: Date.now()
    });
  },

  // Clear cache
  clear(key) {
    if (key) {
      cache.delete(key);
    } else {
      cache.clear();
    }
  },

  // Stats
  getStats() {
    let size = 0;
    for (const v of cache.values()) {
      size += JSON.stringify(v.data).length;
    }
    return {
      entries: cache.size,
      sizeBytes: size
    };
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.cache || DEFAULT_OPTIONS;
    
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = this.generateKey(req, options);
    const cached = this.get(cacheKey);

    if (cached) {
      logger.debug(`Cache hit: ${cacheKey}`);
      
      // Set cache headers
      if (options.cacheControl) {
        const age = Math.ceil((cached.expiresAt - Date.now()) / 1000);
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', cacheKey);
        res.set('Age', age);
      }
      
      // Return cached response
      return res.status(cached.data.status).set(cached.data.headers).send(cached.data.body);
    }

    // Store original send/json
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);

    res.send = (body) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.debug(`Caching response: ${cacheKey}`);
        
        this.set(cacheKey, {
          status: res.statusCode,
          headers: {
            'X-Cache': 'MISS'
          },
          body: typeof body === 'string' ? body : JSON.stringify(body)
        }, options.ttl);
      }
      
      return originalSend(body);
    };

    res.json = (body) => res.send(JSON.stringify(body));

    next();
  }
};
