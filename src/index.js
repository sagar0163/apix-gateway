#!/usr/bin/env node

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ratelimit } from './middleware/ratelimit.js';
import { auth } from './middleware/auth.js';
import { logger } from './utils/logger.js';
import { loadConfig } from './utils/config.js';
import chalk from 'chalk';

const app = express();
const config = loadConfig();

// Security middleware
app.use(helmet());
app.use(cors(config.cors));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Gateway admin API
app.use('/admin', require('./routes/admin.js'));

// Rate limiting
app.use(ratelimit);

// API Routes
app.use('/api', require('./routes/proxy.js'));

// Error handler
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message,
    code: err.code || 'INTERNAL_ERROR'
  });
});

const PORT = config.port || 3000;

app.listen(PORT, () => {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════╗
║                                           ║
║   �ateway  API Gateway v1.0.0              ║
║                                           ║
║   🚀 Server running on port ${PORT}            ║
║   📊 Admin API: http://localhost:${PORT}/admin  ║
║   ❤️  Health:   http://localhost:${PORT}/health  ║
║                                           ║
╚═══════════════════════════════════════════╝
  `));
});

export default app;
