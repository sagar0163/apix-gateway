// Response Transformer Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  addHeaders: {},
  removeHeaders: [],
  transformBody: null, // function(body) { return transformedBody }
  wrapResponse: false,
  wrapperKey: 'data'
};

export default {
  name: 'response-transformer',
  version: '1.0.0',
  description: 'Transform outgoing responses',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['response-transformer'] || DEFAULT_OPTIONS;

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to transform response
    res.json = (body) => {
      // Add headers
      for (const [key, value] of Object.entries(options.addHeaders || {})) {
        res.set(key, value);
      }

      // Remove headers
      for (const header of options.removeHeaders || []) {
        res.removeHeader(header);
      }

      // Transform body
      if (options.transformBody && body && typeof options.transformBody === 'function') {
        try {
          body = options.transformBody(body, req, res);
        } catch (err) {
          logger.error('Response transformation error:', err);
          return originalJson({ 
            error: 'Transformation Error', 
            message: err.message 
          });
        }
      }

      // Wrap response
      if (options.wrapResponse) {
        body = {
          [options.wrapperKey || 'data']: body,
          timestamp: new Date().toISOString(),
          path: req.path
        };
      }

      return originalJson(body);
    };

    next();
  }
};
