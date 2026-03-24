// Connection Pool Plugin - HTTP/HTTPS Agent Pooling
import http from 'http';
import https from 'https';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  maxSockets: 100,        // Max sockets per host
  maxFreeSockets: 10,     // Max free sockets to keep
  timeout: 60000,         // Socket timeout
  keepAlive: true,        // Enable HTTP keep-alive
  keepAliveMsecs: 30000,  // Keep-alive interval
  scheduling: 'lifo',     // 'lifo' or 'fifo'
  // Per-host limits
  perHost: {
    max: 10,            // Max sockets per host
    maxFree: 5          // Max free sockets per host
  }
};

// Singleton agents for connection pooling
const agents = {
  http: null,
  https: null
};

export default {
  name: 'connection-pool',
  version: '1.0.0',
  description: 'HTTP/HTTPS connection pooling for upstream requests',
  defaultOptions: DEFAULT_OPTIONS,

  // Initialize connection pool agents
  init(options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // HTTP agent
    agents.http = new http.Agent({
      maxSockets: opts.maxSockets,
      maxFreeSockets: opts.maxFreeSockets,
      timeout: opts.timeout,
      scheduling: opts.scheduling,
      keepAlive: opts.keepAlive,
      keepAliveMsecs: opts.keepAliveMsecs
    });
    
    // HTTPS agent with mutual TLS support
    agents.https = new https.Agent({
      maxSockets: opts.maxSockets,
      maxFreeSockets: opts.maxFreeSockets,
      timeout: opts.timeout,
      scheduling: opts.scheduling,
      keepAlive: opts.keepAlive,
      keepAliveMsecs: opts.keepAliveMsecs,
      // TLS options for mTLS
      cert: opts.cert,
      key: opts.key,
      ca: opts.ca,
      rejectUnauthorized: opts.rejectUnauthorized !== false
    });
    
    logger.info('Connection pool initialized', {
      maxSockets: opts.maxSockets,
      keepAlive: opts.keepAlive
    });
  },

  // Get appropriate agent for URL
  getAgent(url) {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:' ? agents.https : agents.http;
  },

  // Get agent stats
  getStats() {
    return {
      http: {
        createSocketCount: agents.http?.createSocketCount || 0,
        freeSockets: Object.keys(agents.http?.freeSockets || {}).length,
        sockets: Object.keys(agents.http?.sockets || {}).length,
        requests: Object.keys(agents.http?.requests || {}).length
      },
      https: {
        createSocketCount: agents.https?.createSocketCount || 0,
        freeSockets: Object.keys(agents.https?.freeSockets || {}).length,
        sockets: Object.keys(agents.https?.sockets || {}).length,
        requests: Object.keys(agents.https?.requests || {}).length
      }
    };
  },

  // Close all sockets
  destroy() {
    if (agents.http) {
      agents.http.destroy();
    }
    if (agents.https) {
      agents.https.destroy();
    }
    logger.info('Connection pool destroyed');
  },

  // Middleware to inject agent into proxy requests
  handler: (req, res, next) => {
    // Store agent reference on request for proxy middleware
    req._connectionPool = {
      getAgent: (url) => this.getAgent(url),
      getStats: () => this.getStats()
    };
    next();
  }
};
