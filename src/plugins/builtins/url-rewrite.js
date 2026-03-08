// URL Rewrite Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  rules: [] // [{ pattern: '/old', replacement: '/new', flags: 'g' }]
};

export default {
  name: 'url-rewrite',
  version: '1.0.0',
  description: 'Rewrite URLs before proxying',
  defaultOptions: DEFAULT_OPTIONS,

  // Add rule
  addRule(pattern, replacement, flags = '') {
    const rule = {
      pattern: new RegExp(pattern, flags),
      replacement
    };
    this.rules.push(rule);
  },

  rules: [],

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['url-rewrite'] || DEFAULT_OPTIONS;
    const rules = options.rules || this.rules;
    
    if (rules.length === 0) {
      return next();
    }

    let originalPath = req.path;
    let newPath = originalPath;

    for (const rule of rules) {
      if (rule.pattern.test(newPath)) {
        newPath = newPath.replace(rule.pattern, rule.replacement);
        logger.debug(`URL rewritten: ${originalPath} -> ${newPath}`);
        break; // Apply first matching rule
      }
    }

    if (newPath !== originalPath) {
      req._rewrittenPath = newPath;
      req.url = newPath + (req._parsedUrl?.search || '');
    }

    next();
  }
};
