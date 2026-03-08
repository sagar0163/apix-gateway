import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { pluginManager } from '../plugins/index.js';
import { metrics } from '../plugins/builtins/metrics.js';
import { circuitBreaker } from '../plugins/builtins/circuit-breaker.js';
import { apiKeyPlugin } from '../plugins/builtins/api-key.js';

const router = express.Router();

// In-memory storage
const users = new Map([
  ['admin', { password: 'admin123', role: 'admin' }]
]);

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

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign(
    { id: username, role: user.role },
    config.jwt.secret,
    { expiresIn: '24h' }
  );
  
  res.json({ token, role: user.role });
});

// Stats
router.get('/stats', authenticate, (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Metrics
router.get('/metrics', authenticate, (req, res) => {
  const m = pluginManager.getPlugin('metrics');
  if (m && m.getMetrics) {
    res.json(m.getMetrics());
  } else {
    res.json({ error: 'Metrics plugin not enabled' });
  }
});

// Circuit breakers
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
    res.json({ success: true, message: `Circuit reset for ${req.params.service}` });
  } else {
    res.json({ error: 'Circuit breaker plugin not enabled' });
  }
});

// API Keys management
router.get('/keys', authenticate, (req, res) => {
  const ak = pluginManager.getPlugin('api-key');
  if (ak && ak.listKeys) {
    res.json(ak.listKeys());
  } else {
    res.json({ error: 'API key plugin not enabled' });
  }
});

router.post('/keys', authenticate, (req, res) => {
  const ak = pluginManager.getPlugin('api-key');
  if (ak && ak.addKey) {
    const { name, key, rateLimit, expiresIn } = req.body;
    const fullKey = key || 'apix_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    ak.addKey(fullKey, { 
      name: name || 'Unnamed',
      rateLimit,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null
    });
    res.json({ key: fullKey, name, rateLimit, expiresIn });
  } else {
    res.json({ error: 'API key plugin not enabled' });
  }
});

router.delete('/keys/:key', authenticate, (req, res) => {
  const ak = pluginManager.getPlugin('api-key');
  if (ak && ak.removeKey) {
    ak.removeKey(req.params.key);
    res.json({ success: true });
  } else {
    res.json({ error: 'API key plugin not enabled' });
  }
});

// Plugin management
router.get('/plugins', authenticate, (req, res) => {
  const allPlugins = pluginManager.list();
  const enabled = pluginManager.getEnabledPlugins();
  
  res.json({
    available: allPlugins,
    enabled,
    count: { total: allPlugins.length, enabled: enabled.length }
  });
});

router.post('/plugins/:name/enable', authenticate, (req, res) => {
  const { name } = req.params;
  const { options } = req.body;
  
  try {
    pluginManager.enable(name, options || {});
    res.json({ success: true, message: `Plugin ${name} enabled` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/plugins/:name/disable', authenticate, (req, res) => {
  const { name } = req.params;
  pluginManager.disable(name);
  res.json({ success: true, message: `Plugin ${name} disabled` });
});

router.get('/plugins/:name', authenticate, (req, res) => {
  const plugin = pluginManager.getPlugin(req.params.name);
  if (!plugin) {
    return res.status(404).json({ error: 'Plugin not found' });
  }
  res.json(plugin);
});

export default router;
