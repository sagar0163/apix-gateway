// Header Enrichment Plugin
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const DEFAULT_OPTIONS = {
  addRequestHeaders: {},
  removeRequestHeaders: [],
  addResponseHeaders: {},
  removeResponseHeaders: []
};

export default {
  name: 'header-enrichment',
  version: '1.0.0',
  description: 'Add or remove headers from requests/responses',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['header-enrichment'] || DEFAULT_OPTIONS;

    // Add request headers
    for (const [key, value] of Object.entries(options.addRequestHeaders || {})) {
      // Support dynamic values
      let finalValue = value;
      if (typeof value === 'function') {
        finalValue = value(req);
      } else {
        // Replace placeholders
        finalValue = value
          .replace('${remote_addr}', req.ip)
          .replace('${remote_port}', req.socket?.remotePort || '')
          .replace('${http_host}', req.headers.host || '')
          .replace('${request_method}', req.method)
          .replace('${request_path}', req.path)
          .replace('${request_id}', req.headers['x-request-id'] || crypto.randomUUID());
      }
      req.headers[key.toLowerCase()] = finalValue;
    }

    // Remove request headers
    for (const header of options.removeRequestHeaders || []) {
      delete req.headers[header.toLowerCase()];
    }

    // Store options for response phase
    req._headerEnrichment = options;

    // Wrap response to modify headers
    const originalSetHeader = res.setHeader.bind(res);
    const originalRemoveHeader = res.removeHeader.bind(res);

    res.setHeader = (name, value) => {
      // Add response headers
      const options = req._headerEnrichment || {};
      const additionalHeaders = options.addResponseHeaders || {};
      
      if (additionalHeaders[name]) {
        return originalSetHeader(name, additionalHeaders[name]);
      }
      
      // Skip removed headers
      if (options.removeResponseHeaders?.includes(name)) {
        return;
      }
      
      return originalSetHeader(name, value);
    };

    res.removeHeader = (name) => {
      const options = req._headerEnrichment || {};
      if (options.removeResponseHeaders?.includes(name)) {
        return;
      }
      return originalRemoveHeader(name);
    };

    next();
  }
};
