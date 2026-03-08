// Metrics Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  prefix: 'apix',
  includePath: true,
  includeStatus: true
};

// In-memory metrics store
const metrics = {
  requests: {
    total: 0,
    success: 0,
    errors: 0,
    byStatus: {},
    byPath: {},
    byMethod: {}
  },
  latency: {
    sum: 0,
    count: 0,
    min: Infinity,
    max: 0
  },
  startedAt: Date.now()
};

export default {
  name: 'metrics',
  version: '1.0.0',
  description: 'Request metrics collection plugin',
  defaultOptions: DEFAULT_OPTIONS,

  // Get metrics
  getMetrics() {
    const uptime = Date.now() - metrics.startedAt;
    return {
      ...metrics,
      uptime,
      avgLatency: metrics.latency.count > 0 
        ? Math.round(metrics.latency.sum / metrics.latency.count) 
        : 0,
      rps: metrics.requests.total / (uptime / 1000)
    };
  },

  // Reset metrics
  reset() {
    metrics.requests = {
      total: 0,
      success: 0,
      errors: 0,
      byStatus: {},
      byPath: {},
      byMethod: {}
    };
    metrics.latency = { sum: 0, count: 0, min: Infinity, max: 0 };
    metrics.startedAt = Date.now();
  },

  handler: (req, res, next) => {
    const startTime = Date.now();
    const options = req._pluginOptions?.['metrics'] || DEFAULT_OPTIONS;

    // Track by method
    const method = req.method;
    metrics.requests.byMethod[method] = (metrics.requests.byMethod[method] || 0) + 1;

    // Track by path (sanitized)
    if (options.includePath) {
      const path = req.path.split('/').slice(0, 3).join('/');
      metrics.requests.byPath[path] = (metrics.requests.byPath[path] || 0) + 1;
    }

    // Track response
    const originalSend = res.send;
    res.send = (body) => {
      const status = res.statusCode;
      
      metrics.requests.total++;
      metrics.requests.byStatus[status] = (metrics.requests.byStatus[status] || 0) + 1;

      if (status >= 200 && status < 400) {
        metrics.requests.success++;
      } else {
        metrics.requests.errors++;
      }

      // Track latency
      const latency = Date.now() - startTime;
      metrics.latency.sum += latency;
      metrics.latency.count++;
      metrics.latency.min = Math.min(metrics.latency.min, latency);
      metrics.latency.max = Math.max(metrics.latency.max, latency);

      return originalSend(body);
    };

    next();
  }
};
