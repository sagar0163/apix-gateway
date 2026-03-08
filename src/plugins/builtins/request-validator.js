// Request Validation Plugin (JSON Schema)
import Joi from 'joi';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  schemas: {},
  validateHeaders: true,
  validateQuery: true,
  validateBody: true
};

// Schema storage
const schemas = new Map();

export default {
  name: 'request-validator',
  version: '1.0.0',
  description: 'Request validation using JSON Schema (Joi)',
  defaultOptions: DEFAULT_OPTIONS,

  // Add schema
  addSchema(path, method, schema) {
    const key = `${method}:${path}`;
    schemas.set(key, schema);
  },

  // Get schema
  getSchema(path, method) {
    const key = `${method}:${path}`;
    return schemas.get(key);
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['request-validator'] || DEFAULT_OPTIONS;
    const key = `${req.method}:${req.path}`;
    const schema = schemas.get(key) || options.schemas[key];
    
    if (!schema) {
      return next(); // No schema defined for this route
    }

    const errors = [];

    // Validate headers
    if (options.validateHeaders && schema.headers) {
      const { error } = Joi.object(schema.headers).unknown(true).validate(req.headers);
      if (error) errors.push({ location: 'headers', message: error.message });
    }

    // Validate query
    if (options.validateQuery && schema.query) {
      const { error } = Joi.object(schema.query).validate(req.query);
      if (error) errors.push({ location: 'query', message: error.message });
    }

    // Validate body
    if (options.validateBody && schema.body) {
      const { error } = Joi.object(schema.body).validate(req.body);
      if (error) errors.push({ location: 'body', message: error.message });
    }

    if (errors.length > 0) {
      logger.warn(`Validation failed for ${req.method} ${req.path}:`, errors);
      return res.status(400).json({
        error: 'Validation Failed',
        details: errors
      });
    }

    next();
  }
};
