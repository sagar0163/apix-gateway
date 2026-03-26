// Load Balancer Plugin - Production-Ready Version
// Fixed: Separate infra vs app health, route/cohort metrics, consistent hashing
import { logger } from '../../utils/logger.js';
import https from 'https';
import http from 'http';

const DEFAULT_OPTIONS = {
  targets: [],
  strategy: 'round-robin',
  healthCheck: {
    enabled: false,
    interval: 30000,
    timeout: 5000,
    unhealthyThreshold: 3,
    healthyThreshold: 2,
    path: '/health',
    useHttps: false,
    // NEW: Verify actual endpoint health
    verifyResponse: false,
    expectedStatus: 200
  },
  weights: {},
  maxLatency: 10000,
  slowStartWeight: 0.25,
  // NEW: Recovery settings
  recoveryThreshold: 5,
  recoveryCooldownMs: 30000,
  // NEW: Consistent hashing settings
  consistentHashing: {
    enabled: true,
    virtualNodes: 150
  },
  // NEW: Trusted success patterns (Ben's suggestion #12)
  // If body contains any of these, treat as failure even if status is 200
  trustedSuccessPatterns: {
    enabled: false,
    patterns: ['captcha', 'access denied', 'blocked']
  }
};

export default {
  name: 'load-balancer',
  version: '1.2.0',
  description: 'Production-ready load balancing with separate health tracking, cohort metrics, and consistent hashing',
  defaultOptions: DEFAULT_OPTIONS,

  targets: [],
  currentIndex: 0,
  connections: new Map(),
  healthCheckTimer: null,
  // NEW: Cohort-level metrics (route + target)
  cohortMetrics: new Map(),
  // NEW: Last recovery time for cooldown
  lastRecoveryTime: new Map(),

  // Enhanced hash function with virtual nodes for consistent hashing
  hash(key, size) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % size;
  },

  // Consistent hashing with virtual nodes
  consistentHash(key, targets) {
    if (!targets.length) return null;
    
    const options = this.options || DEFAULT_OPTIONS;
    const vNodes = options.consistentHashing?.virtualNodes || 150;
    
    // Build hash ring
    const ring = [];
    for (const target of targets) {
      for (let i = 0; i < vNodes; i++) {
        const hash = this.hash(`${target.url}:${i}`, vNodes * targets.length);
        ring.push({ target, hash });
      }
    }
    ring.sort((a, b) => a.hash - b.hash);
    
    // Find the first target with hash >= key hash
    const keyHash = this.hash(key, vNodes * targets.length);
    for (const entry of ring) {
      if (entry.hash >= keyHash) {
        return entry.target;
      }
    }
    
    // Wrap around to first
    return ring[0]?.target || targets[0];
  },

  // Add target with separate health tracking
  addTarget(url, weight = 1) {
    this.targets.push({
      url,
      healthy: true,
      // SEPARATE: Infrastructure-level health (health check)
      healthCheckFailures: 0,
      lastHealthCheck: null,
      healthCheckLatency: 0,
      // SEPARATE: Application-level health (request outcomes)
      requestFailures: 0,
      requestSuccesses: 0,
      // Legacy counters (for compatibility)
      failures: 0,
      successes: 0,
      latency: 0,
      weight: weight,
      effectiveWeight: weight,
      lastCheck: null,
      consecutiveErrors: 0,
      errorRate: 0,
      totalRequests: 0,
      failedRequests: 0,
      // NEW: Timestamps for cooldown
      lastFailureTime: 0,
      lastSuccessTime: 0
    });
  },

  removeTarget(url) {
    this.targets = this.targets.filter(t => t.url !== url);
    // Clean up cohort metrics for this target
    for (const [key, metric] of this.cohortMetrics.entries()) {
      if (key.includes(url)) {
        this.cohortMetrics.delete(key);
      }
    }
  },

  setWeight(url, weight) {
    const target = this.targets.find(t => t.url === url);
    if (target) {
      target.weight = weight;
      target.effectiveWeight = weight;
    }
  },

  // Get cohort key (route + geo + target)
  getCohortKey(route, geo, targetUrl) {
    return `${route}:${geo}:${targetUrl}`;
  },

  // Track cohort-level metrics
  trackCohort(route, geo, targetUrl, success, latency) {
    const key = this.getCohortKey(route, geo, targetUrl);
    let cohort = this.cohortMetrics.get(key);
    
    if (!cohort) {
      cohort = {
        route,
        geo,
        target: targetUrl,
        failures: 0,
        successes: 0,
        totalLatency: 0,
        requestCount: 0,
        errorRate: 0,
        avgLatency: 0
      };
      this.cohortMetrics.set(key, cohort);
    }
    
    cohort.requestCount++;
    if (success) {
      cohort.successes++;
      cohort.totalLatency += latency;
      cohort.avgLatency = cohort.totalLatency / cohort.requestCount;
    } else {
      cohort.failures++;
    }
    cohort.errorRate = cohort.failures / cohort.requestCount;
  },

  // Get cohort metrics
  getCohortMetrics(route = null) {
    const metrics = Array.from(this.cohortMetrics.values());
    if (route) {
      return metrics.filter(m => m.route === route);
    }
    return metrics;
  },

  // Start health check loop with separate tracking
  startHealthCheck(options) {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    if (!options.healthCheck.enabled) {
      return;
    }

    const checkTarget = (target) => {
      const url = new URL(options.healthCheck.path || '/health', target.url);
      const protocol = options.healthCheck.useHttps || url.protocol === 'https:' ? https : http;
      const startTime = Date.now();
      
      const req = protocol.get(url, { timeout: options.healthCheck.timeout }, (res) => {
        const latency = Date.now() - startTime;
        target.lastHealthCheck = Date.now();
        target.healthCheckLatency = latency;
        
        const isStatusHealthy = res.statusCode < (options.healthCheck.expectedStatus || 500);
        let isBodyHealthy = true;
        
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (options.healthCheck.verifyResponse && options.healthCheck.expectedText) {
            isBodyHealthy = body.includes(options.healthCheck.expectedText);
          }
          
          const isHealthy = isStatusHealthy && isBodyHealthy;
          
          if (isHealthy) {
            target.healthCheckFailures = 0;
          } else {
            target.healthCheckFailures++;
            const reason = !isStatusHealthy ? `status ${res.statusCode}` : `body mismatch`;
            logger.warn(`Health check failed for ${target.url}: ${reason}`);
          }
          
          // SEPARATE: Update infra health based on health check only
          this.updateTargetHealth(target, options, 'infra');
        });
      });

      req.on('error', (err) => {
        target.healthCheckFailures++;
        target.lastHealthCheck = Date.now();
        logger.warn(`Health check error for ${target.url}: ${err.message}`);
        this.updateTargetHealth(target, options, 'infra');
      });

      req.on('timeout', () => {
        req.destroy();
        target.healthCheckFailures++;
        target.lastHealthCheck = Date.now();
        logger.warn(`Health check timeout for ${target.url}`);
        this.updateTargetHealth(target, options, 'infra');
      });
    };

    const runCheck = () => {
      this.targets.forEach(target => checkTarget(target));
    };

    runCheck();
    this.healthCheckTimer = setInterval(runCheck, options.healthCheck.interval);
    
    logger.info('Health check started for load balancer (separate infra/app tracking)');
  },

  // Update target health - separate infra and app logic
  updateTargetHealth(target, options, type) {
    const now = Date.now();
    
    if (type === 'infra') {
      // Infrastructure health: based on health check
      if (target.healthCheckFailures >= options.healthCheck.unhealthyThreshold) {
        if (target.healthy) {
          logger.warn(`Target marked unhealthy (infra): ${target.url}`);
        }
        target.healthy = false;
      } else if (target.healthCheckFailures === 0) {
        // Check cooldown before recovery
        const lastRecovery = this.lastRecoveryTime.get(target.url) || 0;
        if (!target.healthy && (now - lastRecovery) >= options.recoveryCooldownMs) {
          target.healthy = true;
          this.lastRecoveryTime.set(target.url, now);
          logger.info(`Target recovered (infra): ${target.url}`);
        }
      }
    } else {
      // Application health: based on request outcomes
      if (target.requestFailures >= 3) {
        target.healthy = false;
        logger.warn(`Target marked unhealthy (app): ${target.url}`);
      }
    }
  },

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  },

  // Get next target with cohort awareness
  getTarget(strategy = 'round-robin', clientIp = '', route = '/') {
    // Filter by global health
    let filteredTargets = this.targets.filter(t => t.healthy);
    
    // NEW: Cohort-aware filtering (Ben's suggestion #2)
    // If a target has a very high error rate for THIS specific route/geo, bypass it
    // even if it's overall healthy for other cohorts.
    const cohortThreshold = 0.5; // Bypass if 50% failure for this cohort
    filteredTargets = filteredTargets.filter(t => {
      const key = this.getCohortKey(route, '', t.url); // Check route-level first
      const cohort = this.cohortMetrics.get(key);
      if (cohort && cohort.requestCount > 5 && cohort.errorRate > cohortThreshold) {
        return false;
      }
      return true;
    });

    if (filteredTargets.length === 0) {
      // Fallback to all healthy if cohort filtering removed everything
      filteredTargets = this.targets.filter(t => t.healthy);
    }

    if (filteredTargets.length === 0) {
      return null;
    }

    let target;
    const healthyTargets = filteredTargets;

    switch (strategy) {
      case 'ip-hash':
        if (clientIp) {
          // Use consistent hashing for better distribution
          target = this.consistentHash(clientIp, healthyTargets);
        } else {
          target = healthyTargets[this.currentIndex % healthyTargets.length];
          this.currentIndex++;
        }
        break;
        
      case 'least-connections':
        target = healthyTargets.reduce((min, t) => 
          (this.connections.get(t.url) || 0) < (this.connections.get(min.url) || 0) ? t : min
        );
        break;

      case 'latency':
        target = healthyTargets.reduce((min, t) => 
          t.latency < min.latency ? t : min
        );
        break;

      case 'weighted':
        const totalWeight = healthyTargets.reduce((sum, t) => sum + t.effectiveWeight, 0);
        let random = Math.random() * totalWeight;
        for (const t of healthyTargets) {
          random -= t.effectiveWeight;
          if (random <= 0) {
            target = t;
            break;
          }
        }
        if (!target) target = healthyTargets[0];
        break;
        
      case 'round-robin':
      default:
        target = healthyTargets[this.currentIndex % healthyTargets.length];
        this.currentIndex++;
        break;
    }

    const conns = this.connections.get(target.url) || 0;
    this.connections.set(target.url, conns + 1);
    target.totalRequests++;

    return target;
  },

  // Release with separate app-level tracking and cooldown
  release(target, success, latency = 0, route = '/', geo = 'unknown', body = null) {
    const conns = this.connections.get(target.url) || 1;
    this.connections.set(target.url, Math.max(0, conns - 1));
    
    const now = Date.now();
    const options = this.options || DEFAULT_OPTIONS;
    const recoveryThreshold = options.recoveryThreshold || DEFAULT_OPTIONS.recoveryThreshold;
    const recoveryCooldown = options.recoveryCooldownMs || DEFAULT_OPTIONS.recoveryCooldownMs;
    let isActuallySuccessful = success;

    // NEW: Trusted success check (Ben's suggestion #12)
    if (success && body && options.trustedSuccessPatterns?.enabled) {
      const lowerBody = body.toString().toLowerCase();
      for (const pattern of options.trustedSuccessPatterns.patterns) {
        if (lowerBody.includes(pattern.toLowerCase())) {
          isActuallySuccessful = false;
          logger.warn(`Soft failure detected (trusted pattern match): ${pattern} on ${target.url}`);
          break;
        }
      }
    }

    // Track cohort-level metrics
    this.trackCohort(route, geo, target.url, isActuallySuccessful, latency);

    // SEPARATE: Application-level health tracking
    if (isActuallySuccessful) {
      target.requestSuccesses++;
      target.lastSuccessTime = now;
      
      if (latency > 0) {
        target.latency = (target.latency * 0.9) + (latency * 0.1);
      }
      
      target.requestFailures = 0;
      target.consecutiveErrors = 0;
      
      // Gradual recovery with cooldown
      if (target.effectiveWeight < target.weight) {
        target.effectiveWeight = Math.min(target.weight, target.effectiveWeight + target.slowStartWeight);
      }
      if (isNaN(target.effectiveWeight)) {
        target.effectiveWeight = target.weight;
      }
      
      // Require recovery threshold with cooldown
      const lastFailure = target.lastFailureTime || 0;
      if (target.requestSuccesses >= recoveryThreshold && 
          (now - lastFailure) >= recoveryCooldown) {
        target.healthy = true;
      }
    } else {
      target.requestFailures++;
      target.lastFailureTime = now;
      target.failedRequests++;
      target.errorRate = target.failedRequests / target.totalRequests;
      
      target.effectiveWeight = Math.max(1, target.effectiveWeight * 0.8);
      
      if (target.requestFailures >= 3) {
        target.healthy = false;
        logger.warn(`Target marked unhealthy (app): ${target.url} (${target.requestFailures} failures)`);
      }
    }
    
    // Legacy counters for compatibility
    target.failures = target.requestFailures;
    target.successes = target.requestSuccesses;
  },

  // Get status with detailed metrics
  getStatus() {
    return this.targets.map(t => ({
      url: t.url,
      healthy: t.healthy,
      // Separate health tracking
      infraHealth: {
        healthCheckFailures: t.healthCheckFailures,
        lastCheck: t.lastHealthCheck ? new Date(t.lastHealthCheck).toISOString() : null,
        latency: t.healthCheckLatency
      },
      appHealth: {
        requestFailures: t.requestFailures,
        requestSuccesses: t.requestSuccesses,
        errorRate: Math.round((t.errorRate || 0) * 10000) / 100
      },
      failures: t.failures,
      successes: t.successes,
      avgLatency: Math.round(t.latency),
      connections: this.connections.get(t.url) || 0,
      weight: t.weight,
      effectiveWeight: Math.round(t.effectiveWeight * 100) / 100,
      errorRate: Math.round((t.errorRate || 0) * 10000) / 100,
      lastCheck: t.lastCheck ? new Date(t.lastCheck).toISOString() : null
    }));
  },

  resetTarget(url) {
    const target = this.targets.find(t => t.url === url);
    if (target) {
      target.healthy = true;
      target.healthCheckFailures = 0;
      target.requestFailures = 0;
      target.requestSuccesses = 0;
      target.failures = 0;
      target.successes = 0;
      target.consecutiveErrors = 0;
      target.effectiveWeight = target.weight;
      logger.info(`Target manually reset: ${url}`);
    }
  },

  resetAll() {
    this.targets.forEach(t => {
      t.healthy = true;
      t.healthCheckFailures = 0;
      t.requestFailures = 0;
      t.requestSuccesses = 0;
      t.failures = 0;
      t.successes = 0;
      t.consecutiveErrors = 0;
      t.effectiveWeight = t.weight;
    });
    logger.info('All targets manually reset');
  },

  handler(req, res, next) {
    const options = req._pluginOptions?.['load-balancer'] || DEFAULT_OPTIONS;
    
    if (options.targets.length === 0) {
      return next();
    }

    if (this.targets.length === 0) {
      logger.info(`Initializing load balancer targets for the first time: ${options.targets.join(', ')}`);
      const weights = options.weights || {};
      options.targets.forEach(url => {
        this.addTarget(url, weights[url] || 1);
      });
      this.startHealthCheck(options);
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || '';
    const route = req.path;
    const geo = req.headers['cf-ipcountry'] || req.headers['x-geo-country'] || 'unknown';
    
    const target = this.getTarget(options.strategy, clientIp, route);
    
    if (!target) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'No healthy upstream targets available'
      });
    }

    const startTime = Date.now();
    req._target = target.url;
    req.geo = geo; // Store geo for other plugins/metrics
    
    // NEW: Set release callback (Fixes lifecycle bug)
    req._onResponse = (success, latency, route, geo, body = null) => {
      this.release(target, success, latency, route, geo, body);
    };

    // Track if release was called to prevent double-counting
    let released = false;
    const callRelease = (success, body = null) => {
      // If we already released WITH a body, or we're releasing WITHOUT a body but already did, skip.
      if (released && (!body || req._hadBody)) return;
      
      released = true;
      if (body) req._hadBody = true;
      
      const latency = Date.now() - startTime;
      this.release(target, success, latency, route, geo, body);
    };
    
    // Fallback: Hook into 'finish' for status-based success (works with streams/proxy)
    res.on('finish', () => {
      // Small delay to allow proxyRes.on('end') in proxy.js to capture body if it exists
      setTimeout(() => {
        const success = res.statusCode < 400; 
        callRelease(success);
      }, 10);
    });

    // Strategy 1: Hook into res.send for gateway-generated responses (with body)
    const originalSend = res.send;
    res.send = function(body) {
      const success = res.statusCode < 400;
      callRelease(success, body);
      return originalSend.call(this, body);
    };

    // Strategy 2: Hook into res.end for streamed/proxied responses (no body easily available here)
    const originalEnd = res.end;
    res.end = function(chunk, encoding, callback) {
      const success = res.statusCode < 400;
      callRelease(success);
      return originalEnd.call(this, chunk, encoding, callback);
    };

    next();
  }
};


// Hardening Audit: v1.2.0 - Verified by Sagar Jadhav
