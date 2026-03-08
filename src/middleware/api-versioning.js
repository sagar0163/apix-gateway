// API Versioning Middleware
import { logger } from '../utils/logger.js';

const DEFAULT_OPTIONS = {
  defaultVersion: 'v1',
  versionHeader: 'Accept',
  versionParam: 'version',
  allowedVersions: ['v1', 'v2'],
  deprecatedVersions: [],
  sunsetPolicy: null // { header: 'Sunset', date: '2024-01-01' }
};

// Version configurations
const versionConfigs = {
  v1: {
    status: 'active',
    sunsetDate: null,
    features: ['basic', 'standard']
  },
  v2: {
    status: 'active',
    sunsetDate: null,
    features: ['basic', 'standard', 'advanced', 'graphql']
  }
};

// Parse version from header or param
const parseVersion = (req, options) => {
  // Check query parameter first
  if (req.query[options.versionParam]) {
    return req.query[options.versionParam];
  }
  
  // Check Accept header
  const accept = req.headers[options.versionHeader] || '';
  
  // Match version from header (e.g., application/vnd.apiX-v2+json)
  const match = accept.match(/vnd\.api[Xx]?-v(\d+)/i);
  if (match) {
    return `v${match[1]}`;
  }
  
  return options.defaultVersion;
};

// Create API versioning middleware
export const apiVersioning = (options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return (req, res, next) => {
    const version = parseVersion(req, config);
    
    // Validate version
    if (!config.allowedVersions.includes(version)) {
      logger.warn(`Invalid API version: ${version}`);
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid API version. Allowed: ${config.allowedVersions.join(', ')}`,
        supportedVersions: config.allowedVersions
      });
    }
    
    // Attach version to request
    req.apiVersion = version;
    req.versionConfig = versionConfigs[version];
    
    // Check deprecated versions
    if (config.deprecatedVersions.includes(version)) {
      res.set('Warning', `299 - API version ${version} is deprecated`);
      
      if (config.sunsetPolicy) {
        res.set(config.sunsetPolicy.header, config.sunsetPolicy.date);
      }
    }
    
    // Set response header
    res.set('API-Version', version);
    
    next();
  };
};

// Version-specific route handler
export const versionHandler = (handlers) => {
  return (req, res, next) => {
    const version = req.apiVersion || 'v1';
    const handler = handlers[version] || handlers.default;
    
    if (handler) {
      handler(req, res, next);
    } else {
      next();
    }
  };
};

// Deprecation notice middleware
export const deprecationNotice = (options = {}) => {
  const {
    sunsetDate = null,
    link = null,
    migrationGuide = null
  } = options;

  return (req, res, next) => {
    if (sunsetDate) {
      const sunset = new Date(sunsetDate);
      const now = new Date();
      
      if (sunset > now) {
        // Future sunset
        const daysRemaining = Math.ceil((sunset - now) / (1000 * 60 * 60 * 24));
        
        res.set('Sunset', sunset.toUTCString());
        res.set('Link', link || '</docs/migration>; rel="deprecation"');
        
        if (daysRemaining <= 30) {
          res.set('Warning', `299 - This endpoint will be removed on ${sunset.toDateString()}`);
        }
      } else {
        // Sunset passed - return 410
        return res.status(410).json({
          error: 'Gone',
          message: 'This API version has been sunset',
          sunsetDate: sunset.toISOString(),
          migrationGuide
        });
      }
    }
    
    next();
  };
};

export default {
  apiVersioning,
  versionHandler,
  deprecationNotice
};
