// Input Validation & Sanitization Middleware
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// Sanitization patterns
const patterns = {
  // Remove null bytes
  nullBytes: /\0/g,
  
  // Remove control characters
  controlChars: /[\x00-\x1F\x7F]/g,
  
  // Remove SQL injection patterns
  sqlInjection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/gi,
  
  // Remove script tags (XSS)
  scriptTag: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  
  // Remove event handlers
  eventHandlers: /\s*on\w+\s*=\s*["'][^"']*["']/gi,
  
  // Remove javascript: URLs
  javascriptUrl: /javascript:/gi,
  
  // Remove data: URLs
  dataUrl: /data:/gi
};

// Recursive sanitization
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Prevent prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      // Sanitize key
      const sanitizedKey = sanitizeString(key);
      sanitized[sanitizedKey] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
};

// String sanitization
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  
  let result = str;
  
  // Remove null bytes
  result = result.replace(patterns.nullBytes, '');
  
  // Remove control characters
  result = result.replace(patterns.controlChars, '');
  
  // Remove SQL injection patterns (optional - can cause false positives)
  if (process.env.BLOCK_SQL_INJECTION === 'true') {
    result = result.replace(patterns.sqlInjection, '****');
  }
  
  // Remove script tags
  result = result.replace(patterns.scriptTag, '');
  
  // Remove event handlers
  result = result.replace(patterns.eventHandlers, '');
  
  // Block dangerous URLs
  result = result.replace(patterns.javascriptUrl, 'blocked:');
  result = result.replace(patterns.dataUrl, 'blocked:');
  
  return result;
};

// Input validation schemas
const validators = {
  // Username validation
  username: (value) => {
    if (!value) return 'Username is required';
    if (typeof value !== 'string') return 'Username must be a string';
    if (value.length < 3) return 'Username must be at least 3 characters';
    if (value.length > 30) return 'Username must be at most 30 characters';
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Username can only contain letters, numbers, - and _';
    return null;
  },
  
  // Email validation
  email: (value) => {
    if (!value) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Invalid email format';
    return null;
  },
  
  // Password validation
  password: (value) => {
    if (!value) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    if (process.env.PASSWORD_STRENGTH_CHECK !== 'false') {
      if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter';
      if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter';
      if (!/[0-9]/.test(value)) return 'Password must contain at least one number';
    }
    return null;
  },
  
  // API key validation
  apiKey: (value) => {
    if (!value) return 'API key is required';
    if (value.length < 16) return 'Invalid API key format';
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Invalid API key characters';
    return null;
  },
  
  // UUID validation
  uuid: (value) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) return 'Invalid UUID format';
    return null;
  },
  
  // Numeric range
  numberRange: (value, min, max) => {
    const num = Number(value);
    if (isNaN(num)) return 'Must be a number';
    if (min !== undefined && num < min) return `Must be at least ${min}`;
    if (max !== undefined && num > max) return `Must be at most ${max}`;
    return null;
  },
  
  // String length
  stringLength: (value, min, max) => {
    if (typeof value !== 'string') return 'Must be a string';
    if (min !== undefined && value.length < min) return `Must be at least ${min} characters`;
    if (max !== undefined && value.length > max) return `Must be at most ${max} characters`;
    return null;
  },
  
  // Enum validation
  enum: (value, allowed) => {
    if (!allowed.includes(value)) return `Must be one of: ${allowed.join(', ')}`;
    return null;
  },
  
  // URL validation
  url: (value) => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'URL must use HTTP or HTTPS';
      }
      return null;
    } catch {
      return 'Invalid URL format';
    }
  }
};

// Validation middleware factory
export const validate = (schema) => {
  return (req, res, next) => {
    const errors = [];
    
    // Validate body
    if (schema.body && req.body) {
      for (const [field, rules] of Object.entries(schema.body)) {
        const value = req.body[field];
        const error = validateField(value, rules);
        if (error) {
          errors.push({ field: `body.${field}`, error });
        }
      }
    }
    
    // Validate query
    if (schema.query) {
      for (const [field, rules] of Object.entries(schema.query)) {
        const value = req.query[field];
        const error = validateField(value, rules);
        if (error) {
          errors.push({ field: `query.${field}`, error });
        }
      }
    }
    
    // Validate params
    if (schema.params) {
      for (const [field, rules] of Object.entries(schema.params)) {
        const value = req.params[field];
        const error = validateField(value, rules);
        if (error) {
          errors.push({ field: `params.${field}`, error });
        }
      }
    }
    
    // Validate headers
    if (schema.headers) {
      for (const [field, rules] of Object.entries(schema.headers)) {
        const value = req.headers[field.toLowerCase()];
        const error = validateField(value, rules);
        if (error) {
          errors.push({ field: `headers.${field}`, error });
        }
      }
    }
    
    if (errors.length > 0) {
      logger.warn('Validation failed:', errors);
      return res.status(400).json({
        error: 'Validation Failed',
        details: errors
      });
    }
    
    next();
  };
};

// Validate a single field
const validateField = (value, rules) => {
  // Required check
  if (rules.required && (value === undefined || value === null || value === '')) {
    return 'This field is required';
  }
  
  // Skip further validation if not provided and not required
  if (value === undefined || value === null || value === '') {
    return null;
  }
  
  // Type validation
  if (rules.type) {
    switch (rules.type) {
      case 'string':
        if (typeof value !== 'string') return 'Must be a string';
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) return 'Must be a number';
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return 'Must be a boolean';
        break;
      case 'array':
        if (!Array.isArray(value)) return 'Must be an array';
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) return 'Must be an object';
        break;
    }
  }
  
  // Custom validator
  if (rules.validator && typeof rules.validator === 'function') {
    const error = rules.validator(value);
    if (error) return error;
  }
  
  // Built-in validators
  if (rules.type === 'string') {
    if (rules.minLength || rules.maxLength) {
      const error = validators.stringLength(value, rules.minLength, rules.maxLength);
      if (error) return error;
    }
    
    if (rules.pattern) {
      if (!new RegExp(rules.pattern).test(value)) {
        return `Must match pattern: ${rules.pattern}`;
      }
    }
    
    if (rules.enum) {
      const error = validators.enum(value, rules.enum);
      if (error) return error;
    }
  }
  
  if (rules.type === 'number') {
    const error = validators.numberRange(value, rules.min, rules.max);
    if (error) return error;
  }
  
  return null;
};

// Create validation schemas
export const schemas = {
  login: {
    body: {
      username: { type: 'string', required: true, minLength: 3, maxLength: 30 },
      password: { type: 'string', required: true, minLength: 8 }
    }
  },
  createApiKey: {
    body: {
      name: { type: 'string', required: true, minLength: 1, maxLength: 50 },
      rateLimit: { type: 'number', min: 1, max: 10000 }
    }
  },
  createUser: {
    body: {
      username: { type: 'string', required: true, validator: validators.username },
      email: { type: 'string', required: true, validator: validators.email },
      password: { type: 'string', required: true, validator: validators.password }
    }
  }
};

// Export middleware
export const sanitization = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  next();
};

export default {
  sanitization,
  validate,
  schemas,
  sanitizeString,
  sanitizeObject,
  validators
};


// Hardening Audit: v1.2.0 - Verified by Sagar Jadhav
