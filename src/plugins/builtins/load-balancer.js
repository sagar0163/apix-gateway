// Load Balancer Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  targets: [], // ['http://localhost:3001', 'http://localhost:3002']
  strategy: 'round-robin', // 'round-robin', 'least-connections', 'ip-hash'
  healthCheck: {
    enabled: false,
    interval: 30000,
    timeout: 5000,
    unhealthyThreshold: 3,
    healthyThreshold: 2
  }
};

export default {
  name: 'load-balancer',
  version: '1.0.0',
  description: 'Load balancing across upstream services',
  defaultOptions: DEFAULT_OPTIONS,

  targets: [],
  currentIndex: 0,
  connections: new Map(),

  // Add target
  addTarget(url) {
    this.targets.push({
      url,
      healthy: true,
      failures: 0,
      successes: 0,
      latency: 0
    });
  },

  // Remove target
  removeTarget(url) {
    this.targets = this.targets.filter(t => t.url !== url);
  },

  // Get next target based on strategy
  getTarget(strategy = 'round-robin') {
    const healthyTargets = this.targets.filter(t => t.healthy);
    
    if (healthyTargets.length === 0) {
      return null; // No healthy targets
    }

    let target;

    switch (strategy) {
      case 'ip-hash':
        // Simple hash based on IP would go here
        target = healthyTargets[0];
        break;
        
      case 'least-connections':
        target = healthyTargets.reduce((min, t) => 
          (this.connections.get(t.url) || 0) < (this.connections.get(min.url) || 0) ? t : min
        );
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

    return target;
  },

  // Release target after request
  release(target, success, latency = 0) {
    const conns = this.connections.get(target.url) || 1;
    this.connections.set(target.url, Math.max(0, conns - 1));

    // Update health stats
    if (success) {
      target.successes++;
      target.latency = (target.latency * 0.9) + (latency * 0.1);
      target.failures = 0;
      
      if (target.successes >= 2) {
        target.healthy = true;
      }
    } else {
      target.failures++;
      target.successes = 0;
      
      if (target.failures >= 3) {
        target.healthy = false;
        logger.warn(`Target marked unhealthy: ${target.url}`);
      }
    }
  },

  // Get status
  getStatus() {
    return this.targets.map(t => ({
      url: t.url,
      healthy: t.healthy,
      failures: t.failures,
      avgLatency: Math.round(t.latency),
      connections: this.connections.get(t.url) || 0
    }));
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['load-balancer'] || DEFAULT_OPTIONS;
    
    if (options.targets.length === 0) {
      return next();
    }

    // Initialize targets if needed
    if (this.targets.length === 0) {
      options.targets.forEach(url => this.addTarget(url));
    }

    const target = this.getTarget(options.strategy);
    
    if (!target) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'No healthy upstream targets available'
      });
    }

    // Store target for proxy middleware
    req._target = target.url;
    req._onResponse = () => this.release(target, res.statusCode < 500);
    
    next();
  }
};
