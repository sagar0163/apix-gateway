// Basic Authentication Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  users: {} // { username: password }
};

// User storage
const users = new Map();

export default {
  name: 'basic-auth',
  version: '1.0.0',
  description: 'HTTP Basic authentication',
  defaultOptions: DEFAULT_OPTIONS,

  // Add user
  addUser(username, password, metadata = {}) {
    users.set(username, { password, metadata });
  },

  // Remove user
  removeUser(username) {
    users.delete(username);
  },

  // List users (masked)
  listUsers() {
    return Array.from(users.keys()).map(username => ({
      username,
      metadata: users.get(username).metadata
    }));
  },

  // Base64 decode
  decodeBase64(str) {
    try {
      return Buffer.from(str, 'base64').toString('utf8');
    } catch {
      return '';
    }
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['basic-auth'] || DEFAULT_OPTIONS;
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="API"');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Basic authentication required'
      });
    }

    const base64Credentials = authHeader.slice(6);
    const decoded = this.decodeBase64(base64Credentials);
    const [username, password] = decoded.split(':');

    if (!username || !password) {
      return res.status(401).json({ error: 'Invalid credentials format' });
    }

    // Check user
    const user = users.get(username);
    
    if (!user || user.password !== password) {
      logger.warn(`Basic auth failed for user: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.user = { username, ...user.metadata };
    req.authenticated = true;
    next();
  }
};
