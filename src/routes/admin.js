import express from 'express';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../utils/config.js';
import { pluginManager } from '../plugins/index.js';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { ddosProtection, ddosStats, getBlockedIPs, unblockIP } from '../middleware/ddos-protection.js';
import { connectionPoolStats, clearCache } from '../middleware/performance.js';
import { validate, schemas } from '../middleware/validation.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const config = loadConfig();

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin-only middleware
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  next();
};

// =======================
// Authentication
// =======================

// Login with rate limiting
router.post('/login', 
  rateLimiter.create({ 
    windowMs: 60000, 
    maxRequests: 5,
    skip: (req) => req.ip === '127.0.0.1'
  }),
  validate(schemas.login),
  (req, res) => {
    const { username, password } = req.body;
    
    // In production, use database
    const validUsers = {
      admin: { password: 'admin123', role: 'admin' },
      developer: { password: 'dev123', role: 'developer' }
    };
    
    const user = validUsers[username];
    
    if (!user || user.password !== password) {
      logger.warn(`Login failed for user: ${username} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    logger.info(`User ${username} logged in from ${req.ip}`);
    
    res.json({ 
      token, 
      role: user.role,
      expiresIn: config.jwt.expiresIn
    });
  }
);

// =======================
// Gateway Status
// =======================

// Basic stats
router.get('/stats', authenticate, (req, res) => {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  
  res.json({
    uptime: process.uptime(),
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external
    },
    cpu: {
      user: cpu.user,
      system: cpu.system
    },
    timestamp: new Date().toISOString(),
    plugins: {
      total: pluginManager.list().length,
      enabled: pluginManager.getEnabledPlugins().length
    }
  });
});

// Detailed health
router.get('/health', authenticate, (req, res) => {
  const mem = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + ' MB'
    },
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: process.platform
  });
});

// =======================
// Metrics
// =======================

router.get('/metrics', authenticate, (req, res) => {
  const m = pluginManager.getPlugin('metrics');
  if (m && m.getMetrics) {
    res.json(m.getMetrics());
  } else {
    res.json({ error: 'Metrics plugin not enabled' });
  }
});

// Traffic stats
router.get('/traffic', authenticate, (req, res) => {
  const ts = pluginManager.getPlugin('traffic-stats');
  if (ts && ts.getStats) {
    res.json(ts.getStats());
  } else {
    res.json({ error: 'Traffic stats plugin not enabled' });
  }
});

// =======================
// Circuit Breakers
// =======================

router.get('/circuits', authenticate, (req, res) => {
  const cb = pluginManager.getPlugin('circuit-breaker');
  if (cb && cb.getCircuits) {
    res.json(cb.getCircuits());
  } else {
    res.json({ error: 'Circuit breaker plugin not enabled' });
  }
});

router.post('/circuits/:service/reset', authenticate, (req, res) => {
  const cb = pluginManager.getPlugin('circuit-breaker');
  if (cb && cb.reset) {
    cb.reset(req.params.service);
    logger.info(`Circuit reset for ${req.params.service} by ${req.user.id}`);
    res.json({ success: true, message: `Circuit reset for ${req.params.service}` });
  } else {
    res.json({ error: 'Circuit breaker plugin not enabled' });
  }
});

// =======================
// API Keys
// =======================

router.get('/keys', authenticate, (req, res) => {
  const ak = pluginManager.getPlugin('api-key');
  if (ak && ak.listKeys) {
    res.json(ak.listKeys());
  } else {
    res.json([]);
  }
});

router.post('/keys', authenticate, validate(schemas.createApiKey), (req, res) => {
  const ak = pluginManager.getPlugin('api-key');
  if (ak && ak.addKey) {
    const { name, rateLimit, expiresIn } = req.body;
    const key = 'apix_' + crypto.randomBytes(16).toString('hex');
    ak.addKey(key, { 
      name: name || 'Unnamed',
      rateLimit,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null
    });
    logger.info(`API key created: ${name} by ${req.user.id}`);
    res.json({ key, name, rateLimit, expiresIn });
  } else {
    res.status(400).json({ error: 'API key plugin not enabled' });
  }
});

router.delete('/keys/:key', authenticate, (req, res) => {
  const ak = pluginManager.getPlugin('api-key');
  if (ak && ak.removeKey) {
    ak.removeKey(req.params.key);
    logger.info(`API key deleted: ${req.params.key.slice(0, 8)}... by ${req.user.id}`);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'API key plugin not enabled' });
  }
});

// =======================
// Plugins
// =======================

router.get('/plugins', authenticate, (req, res) => {
  const allPlugins = pluginManager.list();
  const enabled = pluginManager.getEnabledPlugins();
  
  res.json({
    available: allPlugins,
    enabled,
    count: { total: allPlugins.length, enabled: enabled.length }
  });
});

router.get('/plugins/:name', authenticate, (req, res) => {
  const plugin = pluginManager.getPlugin(req.params.name);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }
  res.json(plugin);
});

router.post('/plugins/:name/enable', authenticate, requireAdmin, (req, res) => {
  const { name } = req.params;
  const { options } = req.body;
  
  try {
    pluginManager.enable(name, options || {});
    logger.info(`Plugin enabled: ${name} by ${req.user.id}`);
    res.json({ success: true, message: `Plugin ${name} enabled` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/plugins/:name/disable', authenticate, requireAdmin, (req, res) => {
  const { name } = req.params;
  pluginManager.disable(name);
  logger.info(`Plugin disabled: ${name} by ${req.user.id}`);
  res.json({ success: true, message: `Plugin ${name} disabled` });
});

// =======================
// Security
// =======================

// DDoS stats
router.get('/security/ddos', authenticate, requireAdmin, (req, res) => {
  res.json(ddosStats());
});

// Blocked IPs
router.get('/security/blocked', authenticate, requireAdmin, (req, res) => {
  res.json(getBlockedIPs());
});

// Unblock IP
router.post('/security/unblock', authenticate, requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP address required' });
  }
  unblockIP(ip);
  logger.info(`IP unblocked: ${ip} by ${req.user.id}`);
  res.json({ success: true, message: `IP ${ip} unblocked` });
});

// Cache management
router.post('/cache/clear', authenticate, requireAdmin, (req, res) => {
  clearCache();
  logger.info(`Cache cleared by ${req.user.id}`);
  res.json({ success: true, message: 'Cache cleared' });
});

router.get('/cache/stats', authenticate, (req, res) => {
  res.json(connectionPoolStats());
});

export default router;
