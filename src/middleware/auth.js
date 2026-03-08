import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

export const auth = (req, res, next) => {
  const publicPaths = ['/health', '/admin/login', '/api/public'];
  
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }
  
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    logger.warn('No token provided', { path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('Invalid token', { error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
};
