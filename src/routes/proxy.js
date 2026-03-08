import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

const router = express.Router();

// Load API definitions
const getApiDefinition = (path) => {
  const apis = config.apis || {};
  for (const [prefix, target] of Object.entries(apis)) {
    if (path.startsWith(`/api${prefix}`)) {
      return { prefix, target };
    }
  }
  return null;
};

// Dynamic proxy handler
router.use('/', async (req, res, next) => {
  const api = getApiDefinition(req.path);
  
  if (!api) {
    return res.status(404).json({ error: 'API not found' });
  }
  
  const proxy = createProxyMiddleware({
    target: api.target,
    changeOrigin: true,
    pathRewrite: {
      [`^/api${api.prefix}`]: ''
    },
    onProxyReq: (proxyReq, req) => {
      logger.info(`Proxying to ${api.target}${req.path}`);
      if (req.user) {
        proxyReq.setHeader('X-User-Id', req.user.id);
      }
    },
    onError: (err, req, res) => {
      logger.error('Proxy error', { error: err.message });
      res.status(502).json({ error: 'Bad gateway' });
    }
  });
  
  proxy(req, res, next);
});

export default router;
