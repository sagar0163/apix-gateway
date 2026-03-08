// JWT Authentication Plugin
import jwt from 'jsonwebtoken';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  secret: process.env.JWT_SECRET || 'apix-secret',
  algorithm: 'HS256',
  expiresIn: '24h',
  headerName: 'Authorization',
  headerPrefix: 'Bearer',
  passthrough: false,
  publicPaths: ['/health', '/admin/login', '/api/public']
};

export default {
  name: 'jwt-auth',
  version: '1.0.0',
  description: 'JWT authentication plugin',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['jwt-auth'] || DEFAULT_OPTIONS;
    
    // Check if public path
    if (options.publicPaths?.some(p => req.path.startsWith(p))) {
      return next();
    }

    const authHeader = req.headers[options.headerName?.toLowerCase()];
    
    if (!authHeader) {
      if (options.passthrough) {
        return next();
      }
      logger.warn('No authorization header');
      return res.status(401).json({ error: 'Unauthorized', message: 'No token provided' });
    }

    const token = authHeader.startsWith(options.headerPrefix) 
      ? authHeader.slice(options.headerPrefix.length + 1)
      : authHeader;

    try {
      const decoded = jwt.verify(token, options.secret, {
        algorithms: [options.algorithm]
      });
      req.user = decoded;
      req.authenticated = true;
      next();
    } catch (err) {
      logger.warn('Invalid JWT token:', err.message);
      if (options.passthrough) {
        return next();
      }
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid or expired token' 
      });
    }
  }
};
