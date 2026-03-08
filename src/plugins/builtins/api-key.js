// API Key Authentication Plugin
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const DEFAULT_OPTIONS = {
  headerName: 'x-api-key',
  queryParam: 'api_key',
  allowedKeys: new Map(), // key -> { name, rateLimit, expiresAt }
  passthrough: false
};

// In-memory key store
const apiKeys = new Map();

export default {
  name: 'api-key',
  version: '1.0.0',
  description: 'API Key authentication plugin',
  defaultOptions: DEFAULT_OPTIONS,

  // Method to add keys programmatically
  addKey(key, metadata = {}) {
    apiKeys.set(key, {
      ...metadata,
      createdAt: Date.now()
    });
  },

  // Method to remove keys
  removeKey(key) {
    apiKeys.delete(key);
  },

  // Get all keys (masked)
  listKeys() {
    return Array.from(apiKeys.entries()).map(([key, meta]) => ({
      key: key.slice(0, 8) + '...' + key.slice(-4),
      name: meta.name,
      createdAt: meta.createdAt
    }));
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['api-key'] || DEFAULT_OPTIONS;
    
    // Try header first, then query param
    let apiKey = req.headers[options.headerName] || req.query[options.queryParam];

    if (!apiKey) {
      if (options.passthrough) {
        return next();
      }
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'API key required' 
      });
    }

    const keyData = apiKeys.get(apiKey);

    if (!keyData) {
      // Check if key hash matches (for hashed keys)
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      const hashedKeyData = apiKeys.get(hashedKey);
      
      if (!hashedKeyData) {
        logger.warn('Invalid API key:', apiKey.slice(0, 8) + '...');
        if (options.passthrough) {
          return next();
        }
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Invalid API key' 
        });
      }
      
      apiKey = hashedKey;
    }

    // Check expiration
    if (keyData.expiresAt && keyData.expiresAt < Date.now()) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'API key expired' 
      });
    }

    // Attach key data to request
    req.apiKey = {
      key: apiKey,
      name: keyData.name,
      metadata: keyData.metadata
    };

    next();
  }
};
