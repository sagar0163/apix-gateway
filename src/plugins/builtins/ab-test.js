// A/B Testing Plugin
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const DEFAULT_OPTIONS = {
  experiments: {},
  persist: true,
  excludeBots: true
};

export default {
  name: 'ab-test',
  version: '1.0.0',
  description: 'A/B testing traffic splitting',
  defaultOptions: DEFAULT_OPTIONS,

  getVariant(req, experiment, options) {
    const { variants, cookie = 'ab-test' } = experiment;
    
    const existing = req.cookies?.[cookie];
    if (existing && variants[existing] !== undefined) {
      return existing;
    }

    if (options.excludeBots) {
      const userAgent = req.headers['user-agent'] || '';
      if (/bot|crawler|spider/i.test(userAgent)) {
        return 'control';
      }
    }

    const hash = crypto
      .createHash('md5')
      .update(req.ip + experiment.name + Date.now().toString(36).slice(0, 5))
      .digest('hex');
    
    const num = parseInt(hash.slice(0, 8), 16) % 100;
    
    let cumulative = 0;
    for (const [variant, weight] of Object.entries(variants)) {
      cumulative += weight;
      if (num < cumulative) {
        return variant;
      }
    }

    return 'control';
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['ab-test'] || DEFAULT_OPTIONS;
    
    for (const [name, experiment] of Object.entries(options.experiments || {})) {
      if (req.path.startsWith(experiment.path || '/')) {
        const variant = this.getVariant(req, experiment, options);
        
        req._abTest = {
          experiment: name,
          variant,
          variants: experiment.variants
        };

        if (options.persist) {
          res.cookie(experiment.cookie || 'ab-test', variant, {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true
          });
        }

        res.set('X-AB-Variant', variant);
        res.set('X-AB-Experiment', name);
        break;
      }
    }

    next();
  }
};
