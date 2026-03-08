import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

const router = express.Router();

// In-memory storage (use database in production)
const apiKeys = new Map();
const users = new Map([
  ['admin', { password: 'admin123', role: 'admin' }]
]);

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

// API Keys management
router.get('/keys', (req, res) => {
  const keys = Array.from(apiKeys.values()).map(k => ({
    key: k.key.slice(0, 8) + '...',
    name: k.name,
    rateLimit: k.rateLimit,
    createdAt: k.createdAt
  }));
  res.json(keys);
});

router.post('/keys', (req, res) => {
  const { name, rateLimit } = req.body;
  const key = 'apix_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  
  apiKeys.set(key, {
    key,
    name,
    rateLimit: rateLimit || 100,
    createdAt: new Date()
  });
  
  res.json({ key, name, rateLimit });
});

router.delete('/keys/:key', (req, res) => {
  apiKeys.delete(req.params.key);
  res.json({ success: true });
});

// Stats
router.get('/stats', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    keys: apiKeys.size,
    timestamp: new Date().toISOString()
  });
});

export default router;
