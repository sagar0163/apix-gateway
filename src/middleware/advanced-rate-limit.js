// Advanced Rate Limiting - User-Based & Dynamic
import { logger } from '../utils/logger.js';

// In-memory stores
const userRateLimits = new Map();
const tokenBuckets = new Map();
const slidingWindows = new Map();

// Configuration
const DEFAULT_OPTIONS = {
  // User-based limits
  userDefault: 100,
  userMax: 10000,
  
  // Token bucket settings
  tokenRefillRate: 10, // tokens per second
  tokenCapacity: 100,
  
  // Sliding window
  windowMs: 60000,
  
  // Redis support (optional)
  useRedis: false,
  
  // Dynamic limits
  enableDynamic: true,
  priorityLevels: {
    admin: { limit: 10000, burst: 2000 },
    premium: { limit: 5000, burst: 1000 },
    standard: { limit: 1000, burst: 200 },
    free: { limit: 100, burst: 20 }
  }
};

// Get user tier from request
const getUserTier = (req) => {
  if (req.user?.role === 'admin') return 'admin';
  if (req.user?.tier) return req.user.tier;
  if (req.user) return 'premium';
  return 'free';
};

// Get user-specific limit
const getUserLimit = (req) => {
  const tier = getUserTier(req);
  const tierLimits = DEFAULT_OPTIONS.priorityLevels[tier] || DEFAULT_OPTIONS.priorityLevels.free;
  
  // Check for custom user limit
  const userId = req.user?.id || req.ip;
  const customLimit = userRateLimits.get(userId);
  
  return customLimit || tierLimits;
};

// Token Bucket Algorithm
class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  
  consume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return { allowed: true, remaining: this.tokens };
    }
    
    return { 
      allowed: false, 
      remaining: this.tokens,
      retryAfter: Math.ceil((tokens - this.tokens) / this.refillRate)
    };
  }
  
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

// Sliding Window Algorithm
const slidingWindowCheck = (key, limit, windowMs) => {
  const now = Date.now();
  const window = slidingWindows.get(key) || { requests: [], count: 0 };
  
  // Remove old requests
  const validRequests = window.requests.filter(t => now - t < windowMs);
  
  if (validRequests.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: validRequests[0] + windowMs
    };
  }
  
  // Add current request
  validRequests.push(now);
  slidingWindows.set(key, { requests: validRequests, count: validRequests.length });
  
  return {
    allowed: true,
    remaining: limit - validRequests.length,
    resetAt: now + windowMs
  };
};

// Create advanced rate limiter
export const createAdvancedRateLimiter = (options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async (req, res, next) => {
    const userId = req.user?.id || req.ip;
    const tier = getUserTier(req);
    const limits = getUserLimit(req);
    
    // Strategy selection
    const strategy = req.headers['x-rate-limit-strategy'] || 'token-bucket';
    
    let result;
    
    switch (strategy) {
      case 'token-bucket':
        // Token bucket algorithm
        if (!tokenBuckets.has(userId)) {
          tokenBuckets.set(userId, new TokenBucket(
            limits.burst || config.tokenCapacity,
            config.tokenRefillRate
          ));
        }
        
        const bucket = tokenBuckets.get(userId);
        result = bucket.consume(1);
        break;
        
      case 'sliding-window':
        // Sliding window algorithm
        result = slidingWindowCheck(
          `${tier}:${userId}`,
          limits.limit,
          config.windowMs
        );
        break;
        
      case 'fixed-window':
      default:
        // Fixed window (simpler)
        const windowKey = `${tier}:${userId}:${Math.floor(Date.now() / config.windowMs)}`;
        result = slidingWindowCheck(windowKey, limits.limit, config.windowMs);
        break;
    }
    
    // Set rate limit headers
    res.set('X-RateLimit-Limit', (limits.limit || config.userDefault).toString());
    res.set('X-RateLimit-Remaining', result.remaining.toString());
    res.set('X-RateLimit-Reset', Math.ceil((result.resetAt || Date.now() + config.windowMs) / 1000).toString());
    res.set('X-RateLimit-Strategy', strategy);
    res.set('X-RateLimit-Tier', tier);
    
    if (!result.allowed) {
      logger.warn(`Rate limit exceeded for ${userId} (${tier}): ${result.remaining}/${limits.limit}`);
      
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Tier: ${tier}`,
        limit: limits.limit,
        remaining: 0,
        retryAfter: result.retryAfter || Math.ceil(config.windowMs / 1000),
        tier,
        strategy
      });
    }
    
    next();
  };
};

// Update user rate limit dynamically
export const setUserLimit = (userId, limit) => {
  userRateLimits.set(userId, { limit, updatedAt: Date.now() });
  logger.info(`Updated rate limit for ${userId}: ${limit}`);
};

// Get current rate limit status
export const getRateLimitStatus = (userId, tier = 'free') => {
  const limits = DEFAULT_OPTIONS.priorityLevels[tier] || DEFAULT_OPTIONS.priorityLevels.free;
  const custom = userRateLimits.get(userId);
  const effective = custom?.limit || limits.limit;
  
  let bucketInfo = null;
  let windowInfo = null;
  
  // Get token bucket status
  if (tokenBuckets.has(userId)) {
    const bucket = tokenBuckets.get(userId);
    bucketInfo = {
      tokens: Math.round(bucket.tokens),
      capacity: bucket.capacity
    };
  }
  
  // Get sliding window status
  const windowKey = `${tier}:${userId}`;
  if (slidingWindows.has(windowKey)) {
    const window = slidingWindows.get(windowKey);
    windowInfo = {
      requests: window.count,
      limit: effective
    };
  }
  
  return {
    userId,
    tier,
    effectiveLimit: effective,
    customLimit: custom,
    tokenBucket: bucketInfo,
    slidingWindow: windowInfo
  };
};

// Reset rate limit for user
export const resetUserLimit = (userId) => {
  userRateLimits.delete(userId);
  tokenBuckets.delete(userId);
  slidingWindows.delete(userId);
  logger.info(`Reset rate limit for ${userId}`);
};

// Get all rate limit stats
export const getRateLimitStats = () => {
  return {
    tiers: DEFAULT_OPTIONS.priorityLevels,
    activeUsers: userRateLimits.size,
    activeBuckets: tokenBuckets.size,
    windowEntries: slidingWindows.size
  };
};

export default {
  createAdvancedRateLimiter,
  setUserLimit,
  getRateLimitStatus,
  resetUserLimit,
  getRateLimitStats
};
