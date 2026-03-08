#!/usr/bin/env node

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { pluginManager } from './plugins/index.js';
import chalk from 'chalk';

const app = express();
const config = loadConfig();

// Load and initialize plugins
async function initPlugins() {
  await pluginManager.loadBuiltInPlugins();
  await pluginManager.loadCustomPlugins('./plugins');
  
  // Load plugin configuration from config
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

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
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
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    plugins: pluginManager.getEnabledPlugins()
  });
});

// Gateway admin API
app.use('/admin', require('./routes/admin.js'));

// Plugin middleware
app.use(pluginManager.createMiddleware());

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

// Start server
const PORT = config.port || 3000;

async function start() {
  await initPlugins();
  
  app.listen(PORT, () => {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════╗
║                                           ║
║   🅰️ PIX Gateway  v1.0.0                   ║
║                                           ║
║   🚀 Server running on port ${PORT}            ║
║   📊 Admin API: http://localhost:${PORT}/admin  ║
║   ❤️  Health:   http://localhost:${PORT}/health  ║
║   🔌 Plugins:  ${pluginManager.enabledPlugins.size} enabled                   ║
║                                           ║
╚═══════════════════════════════════════════╝
    `));
  });
}

start().catch(err => {
  logger.error('Failed to start:', err);
  process.exit(1);
});

export default app;
