// Keycloak Integration Plugin
import axios from 'axios';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  realm: '',
  authServerUrl: '',
  clientId: '',
  clientSecret: '',
  public: false,
  verifyToken: true,
  publicPaths: ['/health']
};

export default {
  name: 'keycloak',
  version: '1.0.0',
  description: 'Keycloak/OIDC authentication',
  defaultOptions: DEFAULT_OPTIONS,

  // Get JWKS from Keycloak
  async getJWKS(options) {
    const url = `${options.authServerUrl}/realms/${options.realm}/protocol/openid-connect/certs`;
    const response = await axios.get(url);
    return response.data;
  },

  // Introspect token
  async introspectToken(token, options) {
    const url = `${options.authServerUrl}/realms/${options.realm}/protocol/openid-connect/token/introspect`;
    const response = await axios.post(
      url,
      new URLSearchParams({ token }),
      {
        auth: { username: options.clientId, password: options.clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    return response.data;
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.keycloak || DEFAULT_OPTIONS;

    // Public paths
    if (options.publicPaths?.some(p => req.path.startsWith(p))) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized',
        'WWW-Authenticate': 'Bearer realm="keycloak"'
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');

    // For public clients, just decode without verification
    if (options.public) {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        req.user = payload;
        return next();
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    // Verify token
    this.introspectToken(token, options)
      .then(result => {
        if (result.active) {
          req.user = result;
          req.keycloak = {
            clientId: result.client_id,
            scope: result.scope,
            realm: options.realm
          };
          next();
        } else {
          res.status(401).json({ error: 'Token inactive' });
        }
      })
      .catch(err => {
        logger.error('Keycloak verification error:', err.message);
        res.status(401).json({ error: 'Token verification failed' });
      });
  }
};
