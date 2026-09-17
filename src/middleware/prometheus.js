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
  eventLoopLag: 0,
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
  pluginDuration: {
    byPlugin: {},
    sum: 0,
    count: 0
  },
  uptime: process.startTime
};

// Counter helper
const inc = (obj, key) => {
  obj[key] = (obj[key] || 0) + 1;
};

// Sample event loop lag (ms) with an unref'd timer so it never holds the process open
let eventLoopSamplerStarted = false;
const startEventLoopLagSampling = () => {
  if (eventLoopSamplerStarted) return;
  eventLoopSamplerStarted = true;

  let last = process.hrtime.bigint();
  const sample = () => {
    const now = process.hrtime.bigint();
    metrics.eventLoopLag = Number(now - last) / 1e6;
    last = now;
  };

  const timer = setInterval(sample, 1000);
  if (timer.unref) timer.unref();
  sample();
};

// Prometheus metric family helper (emits HELP/TYPE once, then all label sets)
const promMetricFamily = (name, type, samples) => {
  const lines = [`# HELP ${name} ${type}`, `# TYPE ${name} ${type}`];
  for (const [labels, value] of samples) {
    const labelStr = Object.entries(labels).length > 0
      ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
      : '';
    lines.push(`${name}${labelStr} ${value}`);
  }
  return lines.join('\n') + '\n';
};

// Record plugin duration
export const trackPluginDuration = (pluginName, durationMs) => {
  metrics.pluginDuration.sum += durationMs;
  metrics.pluginDuration.count++;
  if (!metrics.pluginDuration.byPlugin[pluginName]) {
    metrics.pluginDuration.byPlugin[pluginName] = { sum: 0, count: 0 };
  }
  metrics.pluginDuration.byPlugin[pluginName].sum += durationMs;
  metrics.pluginDuration.byPlugin[pluginName].count++;
};

// Create metrics middleware
export const prometheusMetrics = () => {
  return (req, res, next) => {
    const startTime = Date.now();
    const path = req.route?.path || req.path || 'unknown';
    const method = req.method;

    // Track request (status is captured on 'finish' once the route sets it)
    metrics.httpRequests.total++;
    inc(metrics.httpRequests.byMethod, method);

    // Track by path (sanitized)
    const pathKey = path.split('/').slice(0, 4).join('/');
    inc(metrics.httpRequests.byPath, pathKey);

    // Track request size
    const reqSize = parseInt(req.headers['content-length']) || 0;
    if (reqSize > 0) {
      metrics.httpRequestSize.sum += reqSize;
      metrics.httpRequestSize.count++;
    }

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Categorize by actual response status
      inc(metrics.httpRequests.byStatus, statusCode);
      if (statusCode >= 200 && statusCode < 300) {
        metrics.httpRequests.success++;
      } else if (statusCode >= 400 && statusCode < 500) {
        metrics.httpRequests.clientErrors++;
      } else if (statusCode >= 500) {
        metrics.httpRequests.serverErrors++;
      }

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
  startEventLoopLagSampling();
  let output = '';

  // HTTP Requests Total (counter, labeled by method and status)
  const requestSamples = [[{}, metrics.httpRequests.total]];
  for (const [method, count] of Object.entries(metrics.httpRequests.byMethod)) {
    requestSamples.push([{ method }, count]);
  }
  for (const [status, count] of Object.entries(metrics.httpRequests.byStatus)) {
    requestSamples.push([{ status: String(status) }, count]);
  }
  output += promMetricFamily(`${prefix}_http_requests_total`, 'counter', requestSamples);

  // HTTP Request Duration
  const avgDuration = metrics.httpDuration.count > 0
    ? metrics.httpDuration.sum / metrics.httpDuration.count
    : 0;
  output += promMetricFamily(`${prefix}_http_request_duration_seconds`, 'gauge',
    [[{}, (avgDuration / 1000)]]);
  output += promMetricFamily(`${prefix}_http_request_duration_seconds_max`, 'gauge',
    [[{}, (metrics.httpDuration.max / 1000)]]);

  // Request/Response sizes
  const avgReqSize = metrics.httpRequestSize.count > 0
    ? metrics.httpRequestSize.sum / metrics.httpRequestSize.count
    : 0;
  const avgResSize = metrics.httpResponseSize.count > 0
    ? metrics.httpResponseSize.sum / metrics.httpResponseSize.count
    : 0;

  output += promMetricFamily(`${prefix}_http_request_size_bytes`, 'gauge', [[{}, avgReqSize]]);
  output += promMetricFamily(`${prefix}_http_response_size_bytes`, 'gauge', [[{}, avgResSize]]);

  // Plugin metrics
  const avgPluginDuration = metrics.pluginDuration.count > 0
    ? metrics.pluginDuration.sum / metrics.pluginDuration.count
    : 0;
  output += promMetricFamily(`${prefix}_plugin_execution_duration_seconds`, 'gauge',
    [[{}, (avgPluginDuration / 1000)]]);

  const pluginSamples = [];
  for (const [plugin, data] of Object.entries(metrics.pluginDuration.byPlugin)) {
    const avg = data.count > 0 ? data.sum / data.count : 0;
    pluginSamples.push([{ plugin }, (avg / 1000)]);
  }
  output += promMetricFamily(`${prefix}_plugin_duration_seconds`, 'gauge', pluginSamples);

  // Process metrics
  const mem = process.memoryUsage();
  output += promMetricFamily(`${prefix}_process_resident_memory_bytes`, 'gauge', [[{}, mem.rss]]);
  output += promMetricFamily(`${prefix}_process_heap_used_bytes`, 'gauge', [[{}, mem.heapUsed]]);
  output += promMetricFamily(`${prefix}_process_heap_total_bytes`, 'gauge', [[{}, mem.heapTotal]]);
  output += promMetricFamily(`${prefix}_process_uptime_seconds`, 'gauge', [[{}, process.uptime()]]);

  // Event loop lag (ms, sampled)
  output += promMetricFamily(`${prefix}_event_loop_lag_seconds`, 'gauge',
    [[{}, (metrics.eventLoopLag / 1000)]]);

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
  resetMetrics,
  trackPluginDuration
};
