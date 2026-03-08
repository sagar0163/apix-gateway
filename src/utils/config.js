import dotenv from 'dotenv';

dotenv.config();

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
  }
};

export default config;

export const loadConfig = () => config;
