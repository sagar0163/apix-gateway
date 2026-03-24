// Distributed Tracing Plugin - OpenTelemetry Integration
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  serviceName: 'apix-gateway',
  exporter: 'console', // 'console', 'otlp', 'zipkin'
  exporterEndpoint: '',
  sampleRate: 1.0,      // 0-1, percentage of requests to trace
  includeRequestBody: false,
  includeResponseBody: false,
  // Headers to propagate
  propagationHeaders: [
    'x-trace-id',
    'x-span-id',
    'traceparent',
    'tracestate'
  ]
};

// Simple trace context (lightweight implementation)
class TraceContext {
  constructor() {
    this.traces = new Map();
  }

  generateTraceId() {
    return `trace-${Date.now()}-${Math.random().toString(16).substr(2, 16)}`;
  }

  generateSpanId() {
    return `span-${Math.random().toString(16).substr(2, 8)}`;
  }

  startSpan(name, parentTraceId = null) {
    const traceId = parentTraceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const span = {
      name,
      traceId,
      spanId,
      parentId: parentTraceId ? this.generateSpanId() : null,
      startTime: Date.now(),
      attributes: {},
      events: [],
      status: 'ok'
    };
    this.traces.set(traceId, span);
    return span;
  }

  endSpan(traceId, status = 'ok') {
    const span = this.traces.get(traceId);
    if (span) {
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
      span.status = status;
    }
    return span;
  }

  addEvent(traceId, eventName, attributes = {}) {
    const span = this.traces.get(traceId);
    if (span) {
      span.events.push({
        name: eventName,
        time: Date.now(),
        attributes
      });
    }
  }

  setAttribute(traceId, key, value) {
    const span = this.traces.get(traceId);
    if (span) {
      span.attributes[key] = value;
    }
  }

  getTrace(traceId) {
    return this.traces.get(traceId);
  }

  clear() {
    this.traces.clear();
  }
}

const traceContext = new TraceContext();

export default {
  name: 'distributed-trace',
  version: '1.0.0',
  description: 'Distributed tracing with OpenTelemetry-style propagation',
  defaultOptions: DEFAULT_OPTIONS,

  options: DEFAULT_OPTIONS,

  init(options) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    logger.info('Distributed tracing initialized', {
      serviceName: this.options.serviceName,
      exporter: this.options.exporter,
      sampleRate: this.options.sampleRate
    });
  },

  // Extract trace context from incoming headers
  extractContext(req) {
    const headers = req.headers;
    const options = this.options;
    
    // Try W3C traceparent format first
    const traceparent = headers['traceparent'];
    if (traceparent) {
      const match = traceparent.match(/00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/);
      if (match) {
        return {
          traceId: match[1],
          parentSpanId: match[2],
          traceFlags: match[3]
        };
      }
    }
    
    // Fallback to custom headers
    for (const header of options.propagationHeaders) {
      const traceId = headers[header.toLowerCase()];
      if (traceId) {
        return { traceId, parentSpanId: headers['x-span-id'] || null };
      }
    }
    
    return null;
  },

  // Inject trace context into outgoing headers
  injectContext(req, span) {
    const headers = {};
    
    // W3C traceparent format
    const flags = span.status === 'ok' ? '01' : '00';
    headers['traceparent'] = `00-${span.traceId}-${span.spanId}-${flags}`;
    
    // Legacy headers
    headers['x-trace-id'] = span.traceId;
    headers['x-span-id'] = span.spanId;
    
    return headers;
  },

  // Should this request be sampled
  shouldSample() {
    return Math.random() < this.options.sampleRate;
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['distributed-trace'] || DEFAULT_OPTIONS;
    
    // Check if we should sample this request
    if (!this.shouldSample()) {
      return next();
    }

    // Extract or create trace context
    const existingContext = this.extractContext(req);
    const span = traceContext.startSpan(
      `${req.method} ${req.path}`,
      existingContext?.traceId
    );
    
    if (existingContext) {
      span.parentTraceId = existingContext.traceId;
    }

    // Add basic span attributes
    traceContext.setAttribute(span.traceId, 'http.method', req.method);
    traceContext.setAttribute(span.traceId, 'http.url', req.originalUrl);
    traceContext.setAttribute(span.traceId, 'http.target', req.path);
    traceContext.setAttribute(span.traceId, 'service.name', options.serviceName);
    if (req.ip) {
      traceContext.setAttribute(span.traceId, 'client.ip', req.ip);
    }

    // Store trace info on request for downstream use
    req._trace = {
      traceId: span.traceId,
      spanId: span.spanId,
      injectHeaders: (targetSpan) => this.injectContext(req, targetSpan || span)
    };

    // Add trace headers to response
    const originalSend = res.send;
    res.send = function(body) {
      const traceId = req._trace?.traceId;
      
      // Add trace headers
      res.set('x-trace-id', traceId);
      res.set('x-span-id', span.spanId);
      
      // End span
      const status = res.statusCode >= 500 ? 'error' : 'ok';
      traceContext.endSpan(traceId, status);
      
      // Set span attributes
      traceContext.setAttribute(traceId, 'http.status_code', res.statusCode);
      if (res.statusCode >= 400) {
        traceContext.setAttribute(traceId, 'error', 'true');
      }

      // Log trace (in production, send to exporter)
      const completedSpan = traceContext.getTrace(traceId);
      if (options.exporter === 'console') {
        logger.debug('Trace completed', {
          traceId: completedSpan?.traceId,
          duration: completedSpan?.duration,
          status: completedSpan?.status
        });
      }

      return originalSend.call(this, body);
    };

    next();
  },

  // Get trace by ID
  getTrace(traceId) {
    return traceContext.getTrace(traceId);
  },

  // Get all active traces
  getActiveTraces() {
    return Array.from(traceContext.traces.values())
      .filter(s => !s.endTime);
  }
};
