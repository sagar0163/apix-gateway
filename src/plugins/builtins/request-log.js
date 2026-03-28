// Request Log Plugin
import { logger } from '../../utils/logger.js';
import fs from 'fs';

const DEFAULT_OPTIONS = {
  logLevel: 'info', // 'debug', 'info', 'warn', 'error'
  logHeaders: false,
  logBody: false,
  logResponse: false,
  file: null, // if set, also write to file
  json: true
};

export default {
  name: 'request-log',
  version: '1.0.0',
  description: 'Detailed request/response logging',
  defaultOptions: DEFAULT_OPTIONS,
  phase: 'preProxy',

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['request-log'] || DEFAULT_OPTIONS;
    const startTime = Date.now();
    req._startTime = startTime;

    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      referer: req.headers.referer,
      contentType: req.headers['content-type'],
      contentLength: parseInt(req.headers['content-length'] || '0')
    };

    // Store log entry for postHandler
    req._logEntry = logEntry;

    // Add user info if authenticated
    if (req.user) logEntry.user = req.user;
    if (req.apiKey) logEntry.apiKey = req.apiKey.name || req.apiKey.key?.slice(0, 8);

    // Add headers if enabled
    if (options.logHeaders) {
      logEntry.headers = req.headers;
    }

    // Add body if enabled
    if (options.logBody && req.body) {
      logEntry.body = req.body;
    }

    // Track response
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);

    res.send = (body) => {
      logEntry.response = {
        status: res.statusCode,
        size: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body || '')
      };

      if (options.logResponse) {
        logEntry.response.body = body;
      }

      logEntry.latency = Date.now() - startTime;

      // Write log
      if (options.json) {
        const logLine = JSON.stringify(logEntry);
        
        if (options.file) {
          fs.appendFileSync(options.file, logLine + '\n');
        }
        
        logger[options.logLevel](logLine);
      } else {
        logger[options.logLevel](
          `${logEntry.method} ${logEntry.url} ${res.statusCode} ${logEntry.latency}ms`
        );
      }

      return originalSend(body);
    };

    res.json = (body) => res.send(JSON.stringify(body));

    next();
  },

  // Post-proxy hook — logs after upstream response
  postHandler: (req, res, next) => {
    const options = req._pluginOptions?.['request-log'] || DEFAULT_OPTIONS;
    if (req._logEntry && req._startTime) {
      req._logEntry.proxyLatency = Date.now() - req._startTime;
      req._logEntry.proxyComplete = true;
    }
    next();
  },

  // Error hook — logs proxy failures
  onError: (err, req, res, next) => {
    const options = req._pluginOptions?.['request-log'] || DEFAULT_OPTIONS;
    const logEntry = req._logEntry || { method: req.method, path: req.path };
    logEntry.error = {
      message: err.message,
      code: err.code,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    };
    logEntry.latency = req._startTime ? Date.now() - req._startTime : 0;

    logger.error(`Proxy error: ${req.method} ${req.path} - ${err.message}`, logEntry);
    next(err);
  }
};
