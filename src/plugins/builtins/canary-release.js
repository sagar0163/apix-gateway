// Canary Release Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  weights: {}, // { '/api': { stable: 80, canary: 20 } }
  cookieName: 'canary',
  headerName: 'x-canary',
  sticky: true,
  criteria: 'cookie' // 'cookie', 'header', 'ip', 'random'
};

// Canary state
const canaryState = new Map();

export default {
  name: 'canary-release',
  version: '1.0.0',
  description: 'Canary release traffic splitting',
  defaultOptions: DEFAULT_OPTIONS,

  // Determine canary target
  getTarget(req, options) {
    const path = req.path;
    const config = options.weights[path] || options.weights['*'];
    
    if (!config || !config.canary) {
      return 'stable';
    }

    let percentage = 0;

    switch (options.criteria) {
      case 'cookie':
        const cookieValue = req.cookies?.[options.cookieName];
        if (cookieValue) {
          percentage = parseInt(cookieValue, 10);
        }
        break;
        
      case 'header':
        percentage = parseInt(req.headers[options.headerName?.toLower()] || '0', 10);
        break;
        
      case 'ip':
        const ip = req.ip || req.connection?.remoteAddress || '0';
        percentage = parseInt(ip.split('.').pop() || '0', 10) % 100;
        break;
        
      case 'random':
      default:
        percentage = Math.floor(Math.random() * 100);
        break;
    }

    // Stickiness (cache result)
    const stickyKey = options.sticky ? (req.ip || req.headers['x-forwarded-for']) : null;
    if (stickyKey) {
      const cached = canaryState.get(stickyKey);
      if (cached && cached.path === path) {
        return cached.target;
      }
    }

    const target = percentage < config.canary ? 'canary' : 'stable';

    // Cache sticky result
    if (stickyKey) {
      canaryState.set(stickyKey, { path, target, expires: Date.now() + 3600000 });
    }

    return target;
  },

  // Get canary targets
  getTargets(path) {
    return options.weights[path] || {};
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['canary-release'] || DEFAULT_OPTIONS;
    
    const path = req.path;
    const config = options.weights[path] || options.weights['*'];
    
    if (!config) {
      return next();
    }

    const target = this.getTarget(req, options);
    
    // Set canary cookie
    if (options.sticky) {
      const value = target === 'canary' ? config.canary : (100 - config.canary);
      res.cookie(options.cookieName, value.toString(), {
        maxAge: 86400000,
        httpOnly: true
      });
    }

    // Set header for upstream
    req._canary = {
      target,
      config,
      stableUrl: config.stable,
      canaryUrl: config.canaryUrl || config.canary
    };

    res.set('X-Canary', target);
    res.set('X-Canary-Weight', target === 'canary' ? config.canary : (100 - config.canary).toString());

    next();
  }
};
