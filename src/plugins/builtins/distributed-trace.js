// Distributed Tracing Plugin (OpenTelemetry)
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const DEFAULT_OPTIONS = {
  serviceName: 'apix-gateway',
  exporter: 'console', // 'console', 'jaeger', 'zipkin'
  sampleRate: 0.1,
  traceIdHeader: 'x-trace-id',
  parentIdHeader: 'x-parent-id',
  propagateHeaders: ['x-trace-id', 'x-span-id', 'x-parent-id'],
  includeAttrs: {
    httpMethod: true,
    httpUrl: true,
    httpStatusCode: true,
    httpUserAgent: true,
    httpRequestHeaders: false,
    httpResponseHeaders: false
  }
};

// Trace storage (in production, use proper OTLP exporter)
const spans = new Map();
let traceCount = 0;

export default {
  name: 'distributed-trace',
  version: '1.0.0',
  description: 'OpenTelemetry distributed tracing',
  defaultOptions: DEFAULT_OPTIONS,

  // Generate IDs
  generateTraceId() {
    return crypto.randomBytes(16).toString('hex');
  },

  generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
  },

  // Should sample
  shouldSample(rate) {
    return Math.random() < rate;
  },

  // Start span
  startSpan(name, options, parentContext = null) {
    const now = Date.now();
    const traceId = parentContext?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();

    const span = {
      name,
      traceId,
      parentId: parentContext?.spanId || null,
      spanId,
      startTime: now,
      endTime: null,
      status: 'ok',
      attributes: { ...options.attributes },
      events: [],
      kind: 'SERVER'
    };

    spans.set(`${traceId}-${spanId}`, span);
    traceCount++;

    return { traceId, spanId, span };
  },

  // End span
  endSpan(span, status = 'ok', error = null) {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;

    if (error) {
      span.attributes.error = true;
      span.attributes['error.message'] = error.message;
      span.events.push({
        name: 'exception',
        time: Date.now(),
        attributes: { 'error.stack': error.stack }
      });
    }

    // Export based on config
    this.exportSpan(span);
  },

  // Add event
  addEvent(span, eventName, attrs = {}) {
    span.events.push({
      name: eventName,
      time: Date.now(),
      attributes: attrs
    });
  },

  // Export span
  exportSpan(span) {
    // In production, send to Jaeger/Zipkin/OTLP collector
    logger.debug(`[Trace] ${span.name} ${span.spanId} ${span.duration}ms`);
  },

  // Get trace
  getTrace(traceId) {
    const result = [];
    for (const span of spans.values()) {
      if (span.traceId === traceId) {
        result.push(span);
      }
    }
    return result;
  },

  // Get stats
  getStats() {
    return {
      totalTraces: traceCount,
      activeSpans: spans.size
    };
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['distributed-trace'] || DEFAULT_OPTIONS;
    
    // Check sampling
    if (!this.shouldSample(options.sampleRate)) {
      return next();
    }

    // Get or create trace context
    const incomingTraceId = req.headers[options.traceIdHeader];
    const incomingParentId = req.headers[options.parentIdHeader];

    const parentContext = incomingTraceId ? {
      traceId: incomingTraceId,
      spanId: incomingParentId
    } : null;

    // Start span
    const { traceId, spanId, span } = this.startSpan(
      `${req.method} ${req.path}`,
      { attributes: {} },
      parentContext
    );

    // Add request attributes
    if (options.includeAttrs.httpMethod) span.attributes['http.method'] = req.method;
    if (options.includeAttrs.httpUrl) span.attributes['http.url'] = req.originalUrl || req.url;
    if (options.includeAttrs.httpUserAgent) span.attributes['http.user_agent'] = req.headers['user-agent'];
    if (options.includeAttrs.httpRequestHeaders && options.includeAttrs.httpRequestHeaders !== false) {
      span.attributes['http.request.header'] = Object.keys(req.headers).join(',');
    }

    // Propagate headers to response
    res.set(options.traceIdHeader, traceId);
    res.set('x-span-id', spanId);

    // Attach to request
    req._trace = { traceId, spanId, span };

    // Wrap response
    const originalEnd = res.end.bind(res);
    res.end = (chunk) => {
      if (options.includeAttrs.httpStatusCode) {
        span.attributes['http.status_code'] = res.statusCode;
      }
      
      this.endSpan(span, res.statusCode < 400 ? 'ok' : 'error');
      
      return originalEnd(chunk);
    };

    // Handle errors
    res.on('error', (err) => {
      this.endSpan(span, 'error', err);
    });

    next();
  }
};
