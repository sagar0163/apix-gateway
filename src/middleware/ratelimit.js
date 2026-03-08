import { logger } from '../utils/logger.js';
import config from '../config/index.js';

// In-memory store (replace with Redis in production)
const requests = new Map();

export const ratelimit = (req, res, next) => {
  const key = req.ip || req.headers['x-forwarded-for'];
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs || 60000;
  const maxRequests = config.rateLimit.maxRequests || 100;
  
  if (!requests.has(key)) {
    requests.set(key, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  const record = requests.get(key);
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
    return next();
  }
  
  if (record.count >= maxRequests) {
    logger.warn(`Rate limit exceeded for ${key}`);
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }
  
  record.count++;
  next();
};
