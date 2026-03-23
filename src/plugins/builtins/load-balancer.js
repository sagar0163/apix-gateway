// Load Balancer Plugin - Enhanced Version
import { logger } from '../../utils/logger.js';
import https from 'https';
import http from 'http';

const DEFAULT_OPTIONS = {
  targets: [], // ['http://localhost:3001', 'http://localhost:3002']
  strategy: 'round-robin', // 'round-robin', 'least-connections', 'ip-hash', 'latency', 'weighted'
  healthCheck: {
    enabled: false,
    interval: 30000,
    timeout: 5000,
    unhealthyThreshold: 3,
    healthyThreshold: 2,
    path: '/health',
    useHttps: false
  },
  // Weighted routing settings
  weights: {}, // { 'http://localhost:3001': 10, 'http://localhost:3002': 5 }
  // Latency threshold (ms) - mark unhealthy above this
  maxLatency: 10000,
  // Gradual recovery - weight for new targets
  slowStartWeight: 0.25
};

export default {
  name: 'load-balancer',
  version: '1.1.0',
  description: 'Load balancing across upstream services - Enhanced with health checks, weighted routing, and latency tracking',
  defaultOptions: DEFAULT_OPTIONS,

  targets: [],
  currentIndex: 0,
  connections: new Map(),
  healthCheckTimer: null,

  // Consistent hash function for ip-hash
  hash(key, size) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % size;
  },

  // Add target
  addTarget(url, weight = 1) {
    this.targets.push({
      url,
      healthy: true,
      failures: 0,
      successes: 0,
      latency: 0,
      weight: weight,
      effectiveWeight: weight,
      lastCheck: null,
      consecutiveErrors: 0,
      errorRate: 0,
      totalRequests: 0,
      failedRequests: 0
    });
  },

  // Remove target
  removeTarget(url) {
    this.targets = this.targets.filter(t => t.url !== url);
  },

  // Update target weight
  setWeight(url, weight) {
    const target = this.targets.find(t => t.url === url);
    if (target) {
      target.weight = weight;
      target.effectiveWeight = weight;
    }
  },

  // Start health check loop
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
      
      const req = protocol.get(url, { timeout: options.healthCheck.timeout }, (res) => {
        const isHealthy = res.statusCode < 500;
        target.lastCheck = Date.now();
        
        if (isHealthy) {
          target.consecutiveErrors = 0;
          if (!target.healthy && target.successes >= options.healthCheck.healthyThreshold) {
            target.healthy = true;
            logger.info(`Target recovered: ${target.url}`);
          }
        } else {
          target.consecutiveErrors++;
          if (target.consecutiveErrors >= options.healthCheck.unhealthyThreshold) {
            target.healthy = false;
            logger.warn(`Target marked unhealthy by health check: ${target.url}`);
          }
        }
      });

      req.on('error', (err) => {
        target.consecutiveErrors++;
        target.lastCheck = Date.now();
        if (target.consecutiveErrors >= options.healthCheck.unhealthyThreshold) {
          target.healthy = false;
          logger.warn(`Target marked unhealthy (health check error): ${target.url} - ${err.message}`);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        target.consecutiveErrors++;
        if (target.consecutiveErrors >= options.healthCheck.unhealthyThreshold) {
          target.healthy = false;
          logger.warn(`Target marked unhealthy (health check timeout): ${target.url}`);
        }
      });
    };

    // Check all targets
    const runCheck = () => {
      this.targets.forEach(target => checkTarget(target));
    };

    // Initial check
    runCheck();

    // Periodic checks
    this.healthCheckTimer = setInterval(runCheck, options.healthCheck.interval);
    
    logger.info('Health check started for load balancer');
  },

  // Stop health check
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  },

  // Get next target based on strategy
  getTarget(strategy = 'round-robin', clientIp = '') {
    const healthyTargets = this.targets.filter(t => t.healthy);
    
    if (healthyTargets.length === 0) {
      return null; // No healthy targets
    }

    let target;

    switch (strategy) {
      case 'ip-hash':
        // FIXED: Consistent hashing based on client IP
        if (clientIp) {
          const index = this.hash(clientIp, healthyTargets.length);
          target = healthyTargets[index];
        } else {
          // Fallback to round-robin if no IP
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
        // NEW: Route to lowest latency target
        target = healthyTargets.reduce((min, t) => 
          t.latency < min.latency ? t : min
        );
        break;

      case 'weighted':
        // NEW: Weighted random selection
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

    // Track connection
    const conns = this.connections.get(target.url) || 0;
    this.connections.set(target.url, conns + 1);
    target.totalRequests++;

    return target;
  },

  // Release target after request
  release(target, success, latency = 0) {
    const conns = this.connections.get(target.url) || 1;
    this.connections.set(target.url, Math.max(0, conns - 1));

    // Update health stats
    if (success) {
      target.successes++;
      target.failedRequests++;
      // Exponential moving average for latency
      if (latency > 0) {
        target.latency = (target.latency * 0.9) + (latency * 0.1);
      }
      target.failures = 0;
      target.consecutiveErrors = 0;
      
      // Gradual recovery - increase effective weight
      if (target.effectiveWeight < target.weight) {
        target.effectiveWeight = Math.min(target.weight, target.effectiveWeight + target.slowStartWeight);
      }
      // Ensure effectiveWeight is a number
      if (isNaN(target.effectiveWeight)) {
        target.effectiveWeight = target.weight;
      }
      
      if (target.successes >= 2) {
        target.healthy = true;
      }
    } else {
      target.failures++;
      target.consecutiveErrors++;
      target.failedRequests++;
      target.errorRate = target.failedRequests / target.totalRequests;
      
      // Reduce effective weight on failure (gradual degradation)
      target.effectiveWeight = Math.max(1, target.effectiveWeight * 0.8);
      
      if (target.failures >= 3) {
        target.healthy = false;
        logger.warn(`Target marked unhealthy: ${target.url} (${target.failures} failures)`);
      }
    }
  },

  // Get status with detailed metrics
  getStatus() {
    return this.targets.map(t => ({
      url: t.url,
      healthy: t.healthy,
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

  // Reset target health
  resetTarget(url) {
    const target = this.targets.find(t => t.url === url);
    if (target) {
      target.healthy = true;
      target.failures = 0;
      target.successes = 0;
      target.consecutiveErrors = 0;
      target.effectiveWeight = target.weight;
      logger.info(`Target manually reset: ${url}`);
    }
  },

  // Reset all targets
  resetAll() {
    this.targets.forEach(t => {
      t.healthy = true;
      t.failures = 0;
      t.successes = 0;
      t.consecutiveErrors = 0;
      t.effectiveWeight = t.weight;
    });
    logger.info('All targets manually reset');
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['load-balancer'] || DEFAULT_OPTIONS;
    
    if (options.targets.length === 0) {
      return next();
    }

    // Initialize targets if needed
    if (this.targets.length === 0) {
      const weights = options.weights || {};
      options.targets.forEach(url => {
        this.addTarget(url, weights[url] || 1);
      });
      // Start health check if enabled
      this.startHealthCheck(options);
    }

    // Get client IP for ip-hash
    const clientIp = req.ip || req.headers['x-forwarded-for'] || '';
    
    const target = this.getTarget(options.strategy, clientIp);
    
    if (!target) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'No healthy upstream targets available'
      });
    }

    // Capture actual latency
    const startTime = Date.now();

    // Store target for proxy middleware
    req._target = target.url;
    
    // Hook into response to track success/failure
    const originalSend = res.send;
    res.send = function(body) {
      const latency = Date.now() - startTime;
      const success = res.statusCode < 500;
      if (req._onResponse) {
        req._onResponse(success, latency);
      }
      return originalSend.call(this, body);
    };

    next();
  }
};
