// OAuth2 Plugin
import axios from 'axios';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  clientId: '',
  clientSecret: '',
  tokenEndpoint: '',
  introspectionEndpoint: '',
  scopes: [],
  revokeEndpoint: '',
  passthrough: false,
  publicPaths: ['/health']
};

export default {
  name: 'oauth2',
  version: '1.0.0',
  description: 'OAuth2 authentication plugin',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.oauth2 || DEFAULT_OPTIONS;
    
    // Public paths
    if (options.publicPaths?.some(p => req.path.startsWith(p))) {
      return next();
    }

    // Check for authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      if (options.passthrough) return next();
      return res.status(401).json({ 
        error: 'Unauthorized', 
        challenge: 'Bearer realm="api"',
        message: 'OAuth2 token required' 
      });
    }

    // Extract token
    const token = authHeader.replace(/^Bearer\s+/i, '');

    // If introspection endpoint configured, validate token
    if (options.introspectionEndpoint) {
      axios.post(options.introspectionEndpoint, 
        new URLSearchParams({ token }),
        {
          auth: { username: options.clientId, password: options.clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      ).then(response => {
        if (response.data.active) {
          req.user = response.data;
          req.oauth = { scope: response.data.scope, clientId: response.data.client_id };
          next();
        } else {
          if (options.passthrough) return next();
          res.status(401).json({ error: 'Invalid or expired token' });
        }
      }).catch(err => {
        logger.error('OAuth2 introspection error:', err.message);
        if (options.passthrough) return next();
        res.status(401).json({ error: 'Token validation failed' });
      });
    } else {
      // Token is assumed valid (passthrough mode)
      req.oauth = { token };
      next();
    }
  }
};
