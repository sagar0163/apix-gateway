// Request ID Plugin
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  headerName: 'x-request-id',
  generateFn: 'uuid', // 'uuid', 'random', 'timestamp'
  expose: true,
  log: true
};

export default {
  name: 'request-id',
  version: '1.0.0',
  description: 'Add unique request ID for tracing',
  defaultOptions: DEFAULT_OPTIONS,

  generateId(type = 'uuid') {
    switch (type) {
      case 'uuid':
        return crypto.randomUUID();
      case 'random':
        return crypto.randomBytes(16).toString('hex');
      case 'timestamp':
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      default:
        return crypto.randomUUID();
    }
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['request-id'] || DEFAULT_OPTIONS;
    
    // Check for existing ID or generate new
    let requestId = req.headers[options.headerName?.toLowerCase()] || req.headers['x-request-id'];
    
    if (!requestId) {
      requestId = this.generateId(options.generateFn);
    }

    // Attach to request
    req.id = requestId;
    req.requestId = requestId;

    // Set response header
    if (options.expose) {
      res.set(options.headerName || 'x-request-id', requestId);
    }

    // Log
    if (options.log) {
      logger.debug(`[${requestId}] ${req.method} ${req.path}`);
    }

    // Propagate to child processes
    req.headers[options.headerName?.toLowerCase()] = requestId;

    next();
  }
};
