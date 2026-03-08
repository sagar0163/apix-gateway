// Request Mirroring Plugin
import axios from 'axios';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  mirrorTargets: [], // ['http://staging-service:3000']
  mirrorPercent: 0, // 0-100
  mirrorHeaders: true,
  mirrorBody: true,
  async: true
};

export default {
  name: 'request-mirror',
  version: '1.0.0',
  description: 'Mirror requests to secondary targets',
  defaultOptions: DEFAULT_OPTIONS,

  async mirrorRequest(req, options) {
    for (const target of options.mirrorTargets) {
      try {
        const mirrorReq = {
          method: req.method,
          url: target + req.originalUrl,
          headers: options.mirrorHeaders ? { ...req.headers } : {},
          params: req.query,
          timeout: 5000
        };

        if (options.mirrorBody && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
          mirrorReq.data = req.body;
        }

        if (options.async) {
          axios(mirrorReq).catch(() => {}); // Fire and forget
        } else {
          await axios(mirrorReq);
        }

        logger.debug(`Mirrored request to ${target}`);
      } catch (err) {
        logger.error(`Mirror failed for ${target}:`, err.message);
      }
    }
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['request-mirror'] || DEFAULT_OPTIONS;
    
    if (options.mirrorTargets.length === 0) {
      return next();
    }

    // Sample based on percentage
    if (options.mirrorPercent > 0 && Math.random() * 100 > options.mirrorPercent) {
      return next();
    }

    // Mirror after response
    res.on('finish', () => {
      this.mirrorRequest(req, options);
    });

    next();
  }
};
