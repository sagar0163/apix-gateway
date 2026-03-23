import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

const router = express.Router();

// Header sanitization to prevent injection attacks
const sanitizeHeaders = (headers) => {
  const sanitized = { ...headers };
  const dangerousPatterns = [
    /\r\n/gi,      // CRLF injection
    /\x0d\x0a/gi,  // Raw CR LF
    /\x0a/gi,      // LF only
    /\x0d/gi       // CR only
  ];
  
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'string') {
      let sanitizedValue = value;
      for (const pattern of dangerousPatterns) {
        sanitizedValue = sanitizedValue.replace(pattern, '');
      }
      // Reject headers with injection attempts
      if (sanitizedValue !== value) {
        logger.warn(`Blocked header injection attempt: ${key}`);
        delete sanitized[key];
      } else {
        sanitized[key] = sanitizedValue;
      }
    }
  }
  
  // Remove hop-by-hop headers that shouldn't be forwarded
  delete sanitized['connection'];
  delete sanitized['keep-alive'];
  delete sanitized['proxy-authenticate'];
  delete sanitized['proxy-authorization'];
  delete sanitized['te'];
  delete sanitized['trailers'];
  delete sanitized['transfer-encoding'];
  delete sanitized['upgrade'];
  
  return sanitized;
};

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
      
      // Sanitize all incoming headers before forwarding
      const sanitizedHeaders = sanitizeHeaders(req.headers);
      
      // Set sanitized headers (except host)
      for (const [key, value] of Object.entries(sanitizedHeaders)) {
        if (key !== 'host') {
          proxyReq.setHeader(key, value);
        }
      }
      
      // Add user identification if available
      if (req.user) {
        proxyReq.setHeader('X-User-Id', req.user.id);
        proxyReq.setHeader('X-User-Role', req.user.role || 'unknown');
      }
      
      // Add request tracking
      proxyReq.setHeader('X-Forwarded-For', req.ip);
      proxyReq.setHeader('X-Gateway-Request-Id', req.id || `req-${Date.now()}`);
    },
    onProxyRes: (proxyRes, req, res) => {
      // Clean up problematic headers from upstream
      delete proxyRes.headers['www-authenticate'];
    },
    onError: (err, req, res) => {
      logger.error('Proxy error', { error: err.message, code: err.code });
      res.status(502).json({ error: 'Bad gateway', message: 'Upstream service unavailable' });
    }
  });
  
  proxy(req, res, next);
});

export default router;
