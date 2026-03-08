// DDoS Protection & Advanced Rate Limiting
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// Track requests per IP
const ipTracker = new Map();

// Track suspicious activity
const suspiciousActivity = new Map();

// Configuration
const config = {
  // Requests per window
  requestsPerWindow: parseInt(process.env.DDOS_REQUESTS_PER_WINDOW || '100'),
  windowMs: parseInt(process.env.DDOS_WINDOW_MS || '60000'),
  
  // Block duration
  blockDurationMs: parseInt(process.env.DDOS_BLOCK_DURATION || '300000'), // 5 minutes
  
  // Suspicious thresholds
  suspicious4xxThreshold: parseInt(process.env.DDOS_4XX_THRESHOLD || '20'),
  suspicious5xxThreshold: parseInt(process.env.DDOS_5XX_THRESHOLD || '10'),
  
  // Request size anomalies
  maxRequestSize: parseInt(process.env.DDOS_MAX_REQUEST_SIZE || '10485760'), // 10MB
  
  // Slowloris protection
  slowlorisTimeout: parseInt(process.env.DDOS_SLOWLORIS_TIMEOUT || '15000'),
  
  // Challenge settings
  challengeEnabled: process.env.DDOS_CHALLENGE === 'true',
  challengeCookieName: 'ddos_challenge',
  challengeSecret: process.env.DDOS_SECRET || crypto.randomBytes(32).toString('hex')
};

// Track request
const trackRequest = (ip, type = 'request') => {
  const now = Date.now();
  
  if (!ipTracker.has(ip)) {
    ipTracker.set(ip, {
      requests: [],
      firstRequest: now,
      blocked: false,
      blockExpires: 0,
      requestsCount: 0,
      errors4xx: 0,
      errors5xx: 0,
      lastRequest: now
    });
  }
  
  const tracker = ipTracker.get(ip);
  
  // Check if blocked
  if (tracker.blocked && now < tracker.blockExpires) {
    return { blocked: true, remaining: tracker.blockExpires - now };
  } else if (tracker.blocked) {
    // Unblock
    tracker.blocked = false;
    tracker.blockExpires = 0;
    tracker.requests = [];
  }
  
  // Add request to window
  tracker.requests.push(now);
  tracker.requestsCount++;
  tracker.lastRequest = now;
  
  // Clean old requests
  tracker.requests = tracker.requests.filter(t => now - t < config.windowMs);
  
  return { blocked: false };
};

// Track error
const trackError = (ip, statusCode) => {
  const tracker = ipTracker.get(ip);
  if (!tracker) return;
  
  if (statusCode >= 400 && statusCode < 500) {
    tracker.errors4xx++;
  } else if (statusCode >= 500) {
    tracker.errors5xx++;
  }
};

// Block IP
const blockIP = (ip, reason) => {
  const tracker = ipTracker.get(ip);
  if (!tracker) return;
  
  tracker.blocked = true;
  tracker.blockExpires = Date.now() + config.blockD

duration;
  
  logger.warn(`Blocked IP ${ip}: ${reason}`);
  
  // Add to suspicious activity
  suspiciousActivity.set(ip, {
    reason,
    blockedAt: Date.now(),
    requests: tracker.requestsCount
  });
};

// Generate challenge
const generateChallenge = (ip) => {
  const expires = Date.now() + 60000; // 1 minute
  const payload = `${ip}:${expires}:${config.challengeSecret}`;
  const token = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
  
  return {
    token,
    expires,
    cookie: `${config.challengeCookieName}=${token}; Path=/; HttpOnly; Max-Age=60`
  };
};

// Verify challenge
const verifyChallenge = (token, ip) => {
  if (!token) return false;
  
  // In production, store challenges in Redis with TTL
  return true; // Simplified
};

// Create DDoS protection middleware
export const ddosProtection = (options = {}) => {
  const {
    enableChallenge = config.challengeEnabled,
    enableSlowloris = true
  } = options;

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    
    // Check challenge cookie first
    if (enableChallenge) {
      const challengeCookie = req.cookies?.[config.challengeCookieName];
      if (!challengeCookie) {
        // Generate challenge
        if (Math.random() < 0.1) { // Challenge 10% of unknown users
          const challenge = generateChallenge(ip);
          res.set('Set-Cookie', challenge.cookie);
          res.set('X-Challenge', 'required');
          return res.status(403).json({
            error: 'Challenge Required',
            message: 'Please complete the challenge'
          });
        }
      }
    }
    
    // Track request
    const result = trackRequest(ip);
    
    // Check if blocked
    if (result.blocked) {
      logger.warn(`Blocked request from ${ip}, remaining: ${result.remaining}ms`);
      
      res.set('X-Rate-Limit-Blocked', 'true');
      res.set('Retry-After', Math.ceil(result.remaining / 1000).toString());
      
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'You have been temporarily blocked due to suspicious activity',
        blocked: true,
        retryAfter: Math.ceil(result.remaining / 1000)
      });
    }
    
    // Check for slowloris-style requests (incomplete headers)
    if (enableSlowloris) {
      req.setTimeout(config.slowlorisTimeout, () => {
        logger.warn(`Slowloris detected from ${ip}`);
        req.destroy();
        blockIP(ip, 'slowloris attack');
      });
    }
    
    // Track response status
    res.on('finish', () => {
      trackError(ip, res.statusCode);
      
      // Check for suspicious error patterns
      const tracker = ipTracker.get(ip);
      if (tracker) {
        // Too many 4xx errors
        if (tracker.errors4xx > config.suspicious4xxThreshold) {
          blockIP(ip, 'too many 4xx errors');
        }
        // Too many 5xx errors
        if (tracker.errors5xx > config.suspicious5xxThreshold) {
          blockIP(ip, 'too many 5xx errors');
        }
      }
    });
    
    // Set headers
    const tracker = ipTracker.get(ip);
    if (tracker) {
      res.set('X-RateLimit-Limit', config.requestsPerWindow.toString());
      res.set('X-RateLimit-Remaining', Math.max(0, config.requestsPerWindow - tracker.requests.length).toString());
      res.set('X-RateLimit-Reset', Math.ceil((now + config.windowMs) / 1000).toString());
    }
    
    next();
  };
};

// Get blocked IPs
export const getBlockedIPs = () => {
  const blocked = [];
  const now = Date.now();
  
  for (const [ip, tracker] of ipTracker.entries()) {
    if (tracker.blocked && now < tracker.blockExpires) {
      blocked.push({
        ip,
        expires: tracker.blockExpires,
        requests: tracker.requestsCount
      });
    }
  }
  
  return blocked;
};

// Get suspicious activity
export const getSuspiciousActivity = () => {
  return Array.from(suspiciousActivity.entries()).map(([ip, data]) => ({
    ip,
    ...data
  }));
};

// Unblock IP
export const unblockIP = (ip) => {
  const tracker = ipTracker.get(ip);
  if (tracker) {
    tracker.blocked = false;
    tracker.blockExpires = 0;
  }
  suspiciousActivity.delete(ip);
  logger.info(`Unblocked IP: ${ip}`);
};

// Get stats
export const ddosStats = () => {
  let totalRequests = 0;
  let blockedIPs = 0;
  let activeIPs = 0;
  
  const now = Date.now();
  
  for (const [, tracker] of ipTracker.entries()) {
    totalRequests += tracker.requestsCount;
    if (tracker.blocked && now < tracker.blockExpires) {
      blockedIPs++;
    }
    if (now - tracker.lastRequest < 60000) {
      activeIPs++;
    }
  }
  
  return {
    totalRequests,
    activeIPs,
    blockedIPs,
    suspiciousActivity: suspiciousActivity.size
  };
};

export default {
  ddosProtection,
  getBlockedIPs,
  getSuspiciousActivity,
  unblockIP,
  ddosStats
};
