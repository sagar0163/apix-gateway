import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';

dotenv.config();

// Required environment variables that must be set in production
const REQUIRED_ENV_VARS = [
  'JWT_SECRET'
];

// Validate required environment variables
const validateEnvironment = () => {
  // Skip validation in test mode
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return;
  }

  const missing = [];
  const weak = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    } else if (process.env[varName].length < 32) {
      weak.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these variables in your .env file or environment');
    process.exit(1);
  }

  if (weak.length > 0) {
    console.warn(`WARNING: The following variables are too weak (min 32 chars): ${weak.join(', ')}`);
  }

  // Warn about default values
  if (!process.env.JWT_SECRET) {
    console.warn('WARNING: Using default JWT_SECRET - MUST be changed in production!');
  }
};

// Run validation
validateEnvironment();

const DEFAULT_PLUGINS = {
  'rate-limiter': {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
    message: 'Too Many Requests'
  },
  'jwt-auth': {
    enabled: false,
    secret: process.env.JWT_SECRET, // MUST be set - no fallback
    expiresIn: '24h',
    publicPaths: ['/health', '/admin/login', '/api/public']
  },
  'api-key': {
    enabled: false,
    headerName: 'x-api-key'
  },
  'cors': {
    enabled: true,
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true
  },
  'request-transformer': {
    enabled: false
  },
  'response-transformer': {
    enabled: false,
    wrapResponse: false
  },
  'ip-whitelist': {
    enabled: false,
    ips: [],
    mode: 'allow'
  },
  'metrics': {
    enabled: true
  },
  'circuit-breaker': {
    enabled: false,
    failureThreshold: 5,
    timeout: 30000
  },
  'compression': {
    enabled: false,
    threshold: 1024
  }
};

const loadPluginsFromFile = () => {
  try {
    if (fs.existsSync('./plugins.json')) {
      return JSON.parse(fs.readFileSync('./plugins.json', 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load plugins.json:', err.message);
  }
  return {};
};

const config = {
  port: parseInt(process.env.PORT || '3000'),

  jwt: {
    secret: process.env.JWT_SECRET, // MUST be set via environment variable
    expiresIn: '24h'
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'localhost', // Restrictive default
    credentials: true
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_WINDOW_MS || '60000'),
    maxRequests: parseInt(process.env.RATE_MAX_REQUESTS || '100')
  },

  apis: {
    '/users': process.env.API_USERS || 'http://localhost:3001',
    '/orders': process.env.API_ORDERS || 'http://localhost:3002',
    '/products': process.env.API_PRODUCTS || 'http://localhost:3003'
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },

  // Load plugin config from file or use defaults
  plugins: { ...DEFAULT_PLUGINS, ...loadPluginsFromFile() }
};

export default config;

export const loadConfig = () => config;
