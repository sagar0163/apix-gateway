import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '../utils/logger.js';
import config from '../utils/config.js';
import http from 'http';
import https from 'https';

const router = express.Router();

// Connection pool agents (lazy initialized)
let httpAgent = null;
let httpsAgent = null;

// Initialize connection pool
const getHttpAgent = () => {
  if (!httpAgent) {
    httpAgent = new http.Agent({
      maxSockets: 100,
      maxFreeSockets: 10,
      timeout: 60000,
      keepAlive: true,
      keepAliveMsecs: 30000,
      scheduling: 'lifo'
    });
  }
  return httpAgent;
};

const getHttpsAgent = () => {
  if (!httpsAgent) {
    httpsAgent = new https.Agent({
      maxSockets: 100,
      maxFreeSockets: 10,
      timeout: 60000,
      keepAlive: true,
      keepAliveMsecs: 30000,
      scheduling: 'lifo',
      // Secure by default - only disable in development with env var
      rejectUnauthorized: process.env.DISABLE_SSL_VERIFY !== 'true'
    });
  }
  return httpsAgent;
};

// Header sanitization to prevent injection attacks
const sanitizeHeaders = (headers) => {
  const sanitized = { ...headers };
  const dangerousPatterns = [
    /\r\n/gi,
    /\x0d\x0a/gi,
    /\x0a/gi,
    /\x0d/gi
  ];

  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'string') {
      let sanitizedValue = value;
      for (const pattern of dangerousPatterns) {
        sanitizedValue = sanitizedValue.replace(pattern, '');
      }
      if (sanitizedValue !== value) {
        logger.warn(`Blocked header injection attempt: ${key}`);
        delete sanitized[key];
      } else {
        sanitized[key] = sanitizedValue;
      }
    }
  }

  // Remove hop-by-hop headers
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
    if (path.startsWith(prefix)) {
      return { prefix, target };
    }
  }
  return null;
};

// Dynamic proxy handler with connection pooling
router.use('/', async (req, res, next) => {
  const api = getApiDefinition(req.path);

  if (!api) {
    return res.status(404).json({ error: 'API not found' });
  }

  // Determine target (Use load balancer selection if present)
  let target = api.target;
  if (req._target) {
    target = req._target;
    logger.debug(`Using load balancer selected target: ${target}`);
  }

  // Determine if target uses HTTPS
  const targetUrl = new URL(target);
  const isHttps = targetUrl.protocol === 'https:';

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    // Use connection pooling
    agent: isHttps ? getHttpsAgent() : getHttpAgent(),
    // Timeout settings
    proxyTimeout: 30000,
    timeout: 30000,
    // Retry configuration
    retry: {
      retries: 3,
      retryDelay: 100,
      retryOn: [502, 503, 504, 408, 'ECONNREFUSED']
    },
    pathRewrite: {
      [`^${api.prefix}`]: ''
    },
    onProxyReq: (proxyReq, req) => {
      logger.debug(`Proxying to ${api.target}${req.path}`);

      const sanitizedHeaders = sanitizeHeaders(req.headers);

      for (const [key, value] of Object.entries(sanitizedHeaders)) {
        if (key !== 'host') {
          proxyReq.setHeader(key, value);
        }
      }

      if (req.user) {
        proxyReq.setHeader('X-User-Id', req.user.id);
        proxyReq.setHeader('X-User-Role', req.user.role || 'unknown');
      }

      proxyReq.setHeader('X-Forwarded-For', req.ip);
      proxyReq.setHeader('X-Gateway-Request-Id', req.id || `req-${Date.now()}`);
      // Indicate this is a proxied request
      proxyReq.setHeader('X-Proxy-By', 'apix-gateway');
    },
    onProxyRes: (proxyRes, req, res) => {
      delete proxyRes.headers['www-authenticate'];
      // Add response timing header
      const proxyLatency = proxyRes.headers['x-response-time'];
      if (proxyLatency) {
        res.set('X-Upstream-Latency', proxyLatency);
      }

      // Buffer body for Load Balancer soft-failure checks (Ben's suggestion #12)
      const lb = req._pluginOptions?.['load-balancer'];
      if (lb?.enabled && lb.trustedSuccessPatterns?.enabled) {
        let body = Buffer.from([]);
        proxyRes.on('data', (chunk) => {
          // Limit buffering to first 16KB for performance
          if (body.length < 16384) {
            body = Buffer.concat([body, chunk]);
          }
        });
        proxyRes.on('end', () => {
          // Pass captured body to load balancer release if it hasn't been called yet
          if (req._onResponse) {
            const success = res.statusCode < 400;
            const latency = Date.now() - (req._startTime || Date.now());
            const geo = req.headers['cf-ipcountry'] || req.headers['x-geo-country'] || 'unknown';
            req._onResponse(success, latency, req.path, geo, body.toString());
          }
        });
      }
    },
    onError: (err, req, res) => {
      logger.error('Proxy error', { error: err.message, code: err.code, target: api.target });
      res.status(502).json({
        error: 'Bad gateway',
        message: 'Upstream service unavailable',
        code: err.code
      });
    }
  });

  proxy(req, res, next);
});

// Health check endpoint for proxy
router.get('/health/upstreams', (req, res) => {
  const apis = config.apis || {};
  res.json({
    upstreams: Object.entries(apis).map(([prefix, target]) => ({
      prefix,
      target,
      healthy: true  // Could integrate with load balancer health checks
    }))
  });
});

export default router;
