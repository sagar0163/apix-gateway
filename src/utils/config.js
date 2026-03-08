import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const DEFAULT_PLUGINS = {
  'rate-limiter': {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
    message: 'Too Many Requests'
  },
  'jwt-auth': {
    enabled: false,
    secret: process.env.JWT_SECRET || 'apix-secret-key-change-in-production',
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
    secret: process.env.JWT_SECRET || 'apix-secret-key-change-in-production',
    expiresIn: '24h'
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
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
