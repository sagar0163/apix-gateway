#!/usr/bin/env node

import express from 'express';
import { createSecurityMiddleware } from './middleware/security.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { prometheusMetrics } from './middleware/prometheus.js';
import { sanitization, validate, schemas } from './middleware/validation.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { redisManager } from './utils/redis.js';
import { pluginManager } from './plugins/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import http from 'http';
import http2 from 'http2';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const config = loadConfig();

// Trust proxy for correct IP detection
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

// =======================
// SECURITY MIDDLEWARE
// =======================
app.use(createSecurityMiddleware());

// Request body parsing with size limits
app.use(express.json({ 
  limit: process.env.MAX_BODY_SIZE || '1mb',
  strict: true,
  verify: (req, res, buf) => {
    // Verify JSON structure
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_BODY_SIZE || '1mb',
  parameterLimit: 100
}));

// Input sanitization
app.use(sanitization);

// Global rate limiter (before plugins for DoS protection)
app.use(rateLimiter.middleware);

// Prometheus metrics
app.use(prometheusMetrics({ prefix: 'apix' }));

// =======================
// STATIC FILES
// =======================
app.use(express.static(path.join(__dirname, '../ui'), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));

// Prevent static file path traversal
app.use((req, res, next) => {
  if (req.path.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  next();
});

// =======================
// REQUEST LOGGING
// =======================
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    referer: req.get('referer')
  });
  
  // Track response time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, {
      status: res.statusCode,
      duration,
      ip: req.ip
    });
  });
  
  next();
});

// =======================
// HEALTH CHECK
// =======================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    plugins: pluginManager.getEnabledPlugins().map(p => p.name)
  });
});

// Health check with detailed info (authenticated)
app.get('/health/detailed', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    plugins: {
      total: pluginManager.list().length,
      enabled: pluginManager.getEnabledPlugins().length
    },
    config: {
      port: config.port,
      nodeEnv: process.env.NODE_ENV
    }
  });
});

// =======================
// PLUGINS
// =======================
async function initPlugins() {
  await pluginManager.loadBuiltInPlugins();
  await pluginManager.loadCustomPlugins('./plugins');
  
  const pluginConfig = config.plugins || {};
  
  for (const [pluginName, options] of Object.entries(pluginConfig)) {
    if (options.enabled !== false) {
      try {
        pluginManager.enable(pluginName, options);
        logger.info(`Enabled plugin from config: ${pluginName}`);
      } catch (err) {
        logger.error(`Failed to enable plugin ${pluginName}:`, err.message);
      }
    }
  }
  
  logger.info(`Loaded ${pluginManager.list().length} plugins, ${pluginManager.enabledPlugins.size} enabled`);
}

// Load plugins before admin routes
await initPlugins();

// =======================
// ADMIN API
// =======================
app.use('/admin', require('./routes/admin.js'));

// Admin validation middleware
const adminValidate = validate(schemas);

// Apply to admin routes (can be used in routes/admin.js)

// =======================
// PLUGIN MIDDLEWARE
// =======================
app.use(pluginManager.createMiddleware());

// =======================
// API ROUTES
// =======================
app.use('/api', require('./routes/proxy.js'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// =======================
// ERROR HANDLING
// =======================
// JSON parse error
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    logger.error('JSON parse error:', err.message);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON in request body'
    });
  }
  next(err);
});

// General error handler
app.use((err, req, res, next) => {
  logger.error(err.message, { 
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    ip: req.ip,
    path: req.path
  });
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'An error occurred' 
    : err.message;
  
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// =======================

// =======================
// START SERVER
// =======================
const PORT = config.port || 3000;
const USE_HTTP2 = process.env.HTTP2 === 'true';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './ssl/server.key';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './ssl/server.crt';

// Initialize Redis (non-blocking)
redisManager.connect().catch(err => logger.warn('Redis connection skipped:', err.message));

const enabledPlugins = pluginManager.getEnabledPlugins().length;

// Start HTTP server
let server;
server = app.listen(PORT, () => {
  const http2Status = USE_HTTP2 ? 'HTTP/2 Ready (SSL required)' : 'Disabled';
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║   🚀 APIX Gateway  v1.2.0                                    ║
║   🔒 Security Hardened                                         ║
║   📦 Redis Ready (configure to enable)                         ║
║   🌐 Server:      http://localhost:${PORT}                         ║
║   ❤️  Health:     http://localhost:${PORT}/health                   ║
║   🔌 Plugins:     ${enabledPlugins} enabled                              ║
║   HTTP/2:         ${http2Status}                                     ║
╚═══════════════════════════════════════════════════════════════╝
  `));
  logger.info(`Server started on port ${PORT}`);
});

// =======================
// GRACEFUL SHUTDOWN
// =======================
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Stop health checks
    if (pluginManager.getPlugin('load-balancer')) {
      pluginManager.getPlugin('load-balancer').stopHealthCheck();
      logger.info('Health checks stopped');
    }
    
    // Close Redis connection
    redisManager.disconnect().then(() => {
      logger.info('Redis connection closed');
    }).catch(err => {
      logger.warn('Redis disconnect error:', err.message);
    });
    
    // Give time for cleanup
    setTimeout(() => {
      logger.info('Graceful shutdown complete');
      process.exit(0);
    }, 5000);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

export default app;
