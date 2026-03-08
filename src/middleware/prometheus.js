// Prometheus Metrics Middleware
import { logger } from '../utils/logger.js';

// In-memory metrics store
const metrics = {
  httpRequests: {
    total: 0,
    success: 0,
    clientErrors: 0,
    serverErrors: 0,
    byMethod: {},
    byStatus: {},
    byPath: {}
  },
  httpDuration: {
    sum: 0,
    count: 0,
    min: Infinity,
    max: 0
  },
  httpRequestSize: {
    sum: 0,
    count: 0
  },
  httpResponseSize: {
    sum: 0,
    count: 0
  },
  uptime: process.startTime
};

// Counter helper
const inc = (obj, key) => {
  obj[key] = (obj[key] || 0) + 1;
};

// Prometheus format helper
const toPrometheus = (name, value, labels = {}, type = 'gauge') => {
  const labelStr = Object.entries(labels).length > 0 
    ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` 
    : '';
  return `# HELP ${name} ${type}\n# TYPE ${name} ${type}\n${name}${labelStr} ${value}\n`;
};

// Create metrics middleware
export const prometheusMetrics = (options = {}) => {
  const {
    prefix = 'apix',
    includeProcessMetrics = true,
    includeGoMetrics = false
  } = options;

  return (req, res, next) => {
    const startTime = Date.now();
    const path = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const statusCode = res.statusCode;

    // Track request
    metrics.httpRequests.total++;
    inc(metrics.httpRequests.byMethod, method);
    inc(metrics.httpRequests.byStatus, statusCode);
    
    // Categorize
    if (statusCode >= 200 && statusCode < 300) {
      metrics.httpRequests.success++;
    } else if (statusCode >= 400 && statusCode < 500) {
      metrics.httpRequests.clientErrors++;
    } else if (statusCode >= 500) {
      metrics.httpRequests.serverErrors++;
    }

    // Track by path (sanitized)
    const pathKey = path.split('/').slice(0, 4).join('/');
    inc(metrics.httpRequests.byPath, pathKey);

    // Track request size
    const reqSize = parseInt(req.headers['content-length']) || 0;
    if (reqSize > 0) {
      metrics.httpRequestSize.sum += reqSize;
      metrics.httpRequestSize.count++;
    }

    // Track response size
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      // Duration metrics
      metrics.httpDuration.sum += duration;
      metrics.httpDuration.count++;
      metrics.httpDuration.min = Math.min(metrics.httpDuration.min, duration);
      metrics.httpDuration.max = Math.max(metrics.httpDuration.max, duration);

      // Response size
      const resSize = parseInt(res.get('content-length')) || 0;
      if (resSize > 0) {
        metrics.httpResponseSize.sum += resSize;
        metrics.httpResponseSize.count++;
      }
    });

    next();
  };
};

// Get all metrics in Prometheus format
export const getPrometheusMetrics = (options = {}) => {
  const { prefix = 'apix' } = options;
  let output = '';

  // HTTP Requests Total
  output += toPrometheus(`${prefix}_http_requests_total`, metrics.httpRequests.total);
  
  // HTTP Requests by Method
  for (const [method, count] of Object.entries(metrics.httpRequests.byMethod)) {
    output += toPrometheus(`${prefix}_http_requests_total`, count, { method });
  }

  // HTTP Requests by Status
  for (const [status, count] of Object.entries(metrics.httpRequests.byStatus)) {
    output += toPrometheus(`${prefix}_http_requests_total`, count, { status: String(status) });
  }

  // HTTP Request Duration
  const avgDuration = metrics.httpDuration.count > 0 
    ? metrics.httpDuration.sum / metrics.httpDuration.count 
    : 0;
  output += toPrometheus(`${prefix}_http_request_duration_seconds`, avgDuration / 1000);
  output += toPrometheus(`${prefix}_http_request_duration_seconds_max`, metrics.httpDuration.max / 1000);

  // Request/Response sizes
  const avgReqSize = metrics.httpRequestSize.count > 0 
    ? metrics.httpRequestSize.sum / metrics.httpRequestSize.count 
    : 0;
  const avgResSize = metrics.httpResponseSize.count > 0 
    ? metrics.httpResponseSize.sum / metrics.httpResponseSize.count 
    : 0;
  
  output += toPrometheus(`${prefix}_http_request_size_bytes`, avgReqSize);
  output += toPrometheus(`${prefix}_http_response_size_bytes`, avgResSize);

  // Process metrics
  const mem = process.memoryUsage();
  output += toPrometheus(`${prefix}_process_resident_memory_bytes`, mem.rss);
  output += toPrometheus(`${prefix}_process_heap_used_bytes`, mem.heapUsed);
  output += toPrometheus(`${prefix}_process_heap_total_bytes`, mem.heapTotal);
  output += toPrometheus(`${prefix}_process_uptime_seconds`, process.uptime());

  // Event loop lag (simplified)
  output += toPrometheus(`${prefix}_event_loop_lag_seconds`, 0);

  return output;
};

// Get JSON metrics
export const getMetricsJSON = () => {
  const mem = process.memoryUsage();
  const avgDuration = metrics.httpDuration.count > 0 
    ? metrics.httpDuration.sum / metrics.httpDuration.count 
    : 0;

  return {
    requests: {
      total: metrics.httpRequests.total,
      success: metrics.httpRequests.success,
      clientErrors: metrics.httpRequests.clientErrors,
      serverErrors: metrics.httpRequests.serverErrors,
      byMethod: metrics.httpRequests.byMethod,
      byStatus: metrics.httpRequests.byStatus
    },
    duration: {
      avg: Math.round(avgDuration),
      min: metrics.httpDuration.min === Infinity ? 0 : metrics.httpDuration.min,
      max: metrics.httpDuration.max
    },
    size: {
      request: {
        avg: metrics.httpRequestSize.count > 0 
          ? Math.round(metrics.httpRequestSize.sum / metrics.httpRequestSize.count) 
          : 0
      },
      response: {
        avg: metrics.httpResponseSize.count > 0 
          ? Math.round(metrics.httpResponseSize.sum / metrics.httpResponseSize.count) 
          : 0
      }
    },
    process: {
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external
      }
    }
  };
};

// Reset metrics
export const resetMetrics = () => {
  metrics.httpRequests = {
    total: 0,
    success: 0,
    clientErrors: 0,
    serverErrors: 0,
    byMethod: {},
    byStatus: {},
    byPath: {}
  };
  metrics.httpDuration = {
    sum: 0,
    count: 0,
    min: Infinity,
    max: 0
  };
  metrics.httpRequestSize = { sum: 0, count: 0 };
  metrics.httpResponseSize = { sum: 0, count: 0 };
  logger.info('Metrics reset');
};

export default {
  prometheusMetrics,
  getPrometheusMetrics,
  getMetricsJSON,
  resetMetrics
};
