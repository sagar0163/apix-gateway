// Request Transformer Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  addHeaders: {},
  removeHeaders: [],
  addQueryParams: {},
  removeQueryParams: [],
  transformBody: null // function(body) { return transformedBody }
};

export default {
  name: 'request-transformer',
  version: '1.0.0',
  description: 'Transform incoming requests',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['request-transformer'] || DEFAULT_OPTIONS;

    // Add headers
    for (const [key, value] of Object.entries(options.addHeaders || {})) {
      req.headers[key.toLowerCase()] = value;
    }

    // Remove headers
    for (const header of options.removeHeaders || []) {
      delete req.headers[header.toLowerCase()];
    }

    // Add query params
    req.query = {
      ...req.query,
      ...(options.addQueryParams || {})
    };

    // Remove query params
    for (const param of options.removeQueryParams || []) {
      delete req.query[param];
    }

    // Transform body
    if (options.transformBody && req.body && typeof options.transformBody === 'function') {
      try {
        req.body = options.transformBody(req.body);
      } catch (err) {
        logger.error('Body transformation error:', err);
        return res.status(400).json({ 
          error: 'Bad Request', 
          message: 'Invalid request body transformation' 
        });
      }
    }

    next();
  }
};
