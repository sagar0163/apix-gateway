// Dynamic Routing Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  rules: [], // [{ path: '/api/v1/*', target: 'http://v1-service:3000', strip: '/api/v1' }]
  defaultTarget: '',
  matchStrategy: 'first' // 'first', 'best'
};

export default {
  name: 'dynamic-routing',
  version: '1.0.0',
  description: 'Dynamic routing based on rules',
  defaultOptions: DEFAULT_OPTIONS,

  routes: new Map(),

  // Add route
  addRoute(pattern, target, options = {}) {
    const regex = new RegExp(pattern.replace('*', '.*'));
    this.routes.set(regex, { target, strip: options.strip || '', priority: options.priority || 0 });
  },

  // Find matching route
  findRoute(path) {
    const matches = [];
    
    for (const [regex, route] of this.routes.entries()) {
      if (regex.test(path)) {
        matches.push(route);
      }
    }

    if (matches.length === 0) return null;

    // Sort by priority
    matches.sort((a, b) => b.priority - a.priority);
    
    return matches[0];
  },

  // Rewrite path
  rewritePath(path, strip) {
    if (!strip) return path;
    return path.replace(new RegExp(`^${strip}`), '') || '/';
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['dynamic-routing'] || DEFAULT_OPTIONS;
    
    // Check configured rules first
    let route = null;
    
    for (const rule of options.rules || []) {
      const pattern = rule.path || rule.pattern;
      const regex = new RegExp(pattern.replace('*', '.*'));
      
      if (regex.test(req.path)) {
        route = rule;
        break;
      }
    }

    // Check programmatic routes
    if (!route) {
      route = this.findRoute(req.path);
    }

    if (route) {
      const target = route.target || route.url || route.upstream;
      
      if (target) {
        req._routing = {
          target,
          originalPath: req.path,
          rewrittenPath: this.rewritePath(req.path, route.strip)
        };
        
        // Modify request URL
        if (route.strip) {
          req.url = this.rewritePath(req.url, route.strip);
          req.path = this.rewritePath(req.path, route.strip);
        }

        res.set('X-Dynamic-Route', 'true');
        res.set('X-Upstream', target);
        
        logger.debug(`Dynamic route: ${req.path} -> ${target}`);
      }
    }

    next();
  }
};
