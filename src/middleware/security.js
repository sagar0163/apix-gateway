// Security Middleware - Comprehensive protection
import helmet from 'helmet';
import cors from 'cors';
import { logger } from '../utils/logger.js';

// Security headers configuration
const securityHeaders = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      connectSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
};

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // In production, configure allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['*'];
    
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      logger.warn(`CORS rejected origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400,
  optionsSuccessStatus: 204
};

// Request sanitization
const sanitizeRequest = (req, res, next) => {
  // Remove potentially dangerous headers
  delete req.headers['x-forwarded-host'];
  delete req.headers['x-forwarded-proto'];
  
  // Sanitize query parameters
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        // Remove null bytes and control characters
        req.query[key] = req.query[key].replace(/[\x00-\x1F\x7F]/g, '');
      }
    }
  }
  
  next();
};

// IP validation
const ipValidation = (req, res, next) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'];
  
  // Check for invalid IPs
  if (!clientIp || clientIp === 'unknown' || clientIp === 'null') {
    logger.warn('Invalid IP address detected');
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Block private IPs in X-Forwarded-For (potential spoofing)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    const hasPrivateIP = ips.some(ip => {
      return ip.startsWith('10.') || 
             ip.startsWith('192.168.') || 
             ip.startsWith('172.16.') ||
             ip.startsWith('127.');
    });
    
    if (hasPrivateIP && process.env.NODE_ENV === 'production') {
      logger.warn(`Private IP spoofing attempt blocked: ${forwardedFor}`);
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Direct access from private networks is not allowed' 
      });
    }
  }
  
  next();
};

// Request size validation
const MAX_BODY_SIZE = parseInt(process.env.MAX_BODY_SIZE || '1048576'); // 1MB default
const MAX_HEADER_SIZE = parseInt(process.env.MAX_HEADER_SIZE || '8192'); // 8KB default

const validateRequestSize = (req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0');
  
  if (contentLength > MAX_BODY_SIZE) {
    logger.warn(`Request body too large: ${contentLength} bytes`);
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Maximum body size is ${MAX_BODY_SIZE} bytes`
    });
  }
  
  // Check header size
  const headerSize = Object.keys(req.headers)
    .reduce((acc, key) => acc + key.length + String(req.headers[key]).length, 0);
  
  if (headerSize > MAX_HEADER_SIZE) {
    logger.warn(`Request headers too large: ${headerSize} bytes`);
    return res.status(431).json({
      error: 'Request Headers Too Large',
      message: `Maximum header size is ${MAX_HEADER_SIZE} bytes`
    });
  }
  
  next();
};

// HTTP Method validation
const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
const validateMethod = (req, res, next) => {
  if (!allowedMethods.includes(req.method)) {
    return res.status(405).json({
      error: 'Method Not Allowed',
      message: `Method ${req.method} not allowed`
    });
  }
  next();
};

// URL validation - block path traversal and dangerous patterns
const validateUrl = (req, res, next) => {
  const url = req.path || req.url;
  
  // Block path traversal
  if (url.includes('..') || url.includes('//')) {
    logger.warn(`Path traversal attempt: ${url}`);
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  // Block null bytes
  if (url.includes('\0')) {
    logger.warn('Null byte in URL');
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  // Block common attack patterns
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /data:\s*text\/html/i,
    /vbscript:/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(url)) {
      logger.warn(`Malicious URL pattern detected: ${url}`);
      return res.status(400).json({ error: 'Invalid request' });
    }
  }
  
  next();
};

// Timeout protection
const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT || '30000');

const timeoutMiddleware = (req, res, next) => {
  res.setTimeout(requestTimeout, () => {
    if (!res.headersSent) {
      logger.error(`Request timeout: ${req.method} ${req.path}`);
      res.status(408).json({
        error: 'Request Timeout',
        message: 'Request took too long to process'
      });
      res.end();
    }
  });
  next();
};

// Create complete security middleware
export const createSecurityMiddleware = (options = {}) => {
  return [
    // Headers
    helmet(options.helmet || securityHeaders),
    
    // CORS
    cors(options.cors || corsOptions),
    
    // Validation
    sanitizeRequest,
    ipValidation,
    validateRequestSize,
    validateMethod,
    validateUrl,
    timeoutMiddleware
  ];
};

export default {
  createSecurityMiddleware,
  securityHeaders,
  corsOptions
};
