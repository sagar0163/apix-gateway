// Request Size Limit Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  maxBodySize: 1048576, // 1MB in bytes
  maxHeaderSize: 8192, // 8KB
  errorCode: 413,
  includePayload: false
};

export default {
  name: 'request-size',
  version: '1.0.0',
  description: 'Limit request body and header size',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['request-size'] || DEFAULT_OPTIONS;

    // Check Content-Length header
    const contentLength = parseInt(req.headers['content-length'] || '0');
    
    if (contentLength > options.maxBodySize) {
      logger.warn(`Request body too large: ${contentLength} bytes (max: ${options.maxBodySize})`);
      return res.status(options.errorCode).json({
        error: 'Payload Too Large',
        message: `Request body exceeds maximum size of ${options.maxBodySize} bytes`,
        maxSize: options.maxBodySize,
        received: contentLength
      });
    }

    // Check header size
    const headerSize = Object.keys(req.headers)
      .reduce((acc, key) => acc + key.length + String(req.headers[key]).length, 0);

    if (headerSize > options.maxHeaderSize) {
      logger.warn(`Request headers too large: ${headerSize} bytes (max: ${options.maxHeaderSize})`);
      return res.status(options.errorCode).json({
        error: 'Request Headers Too Large',
        message: `Request headers exceed maximum size of ${options.maxHeaderSize} bytes`
      });
    }

    // Wrap req.on to track body size if needed
    if (options.includePayload) {
      let bodySize = 0;
      const originalOn = req.on.bind(req);
      
      req.on = (event, listener) => {
        if (event === 'data') {
          originalOn('data', (chunk) => {
            bodySize += chunk.length;
            if (bodySize > options.maxBodySize) {
              logger.warn(`Streaming body exceeded limit: ${bodySize}`);
              req.destroy();
              return res.status(options.errorCode).json({
                error: 'Payload Too Large',
                message: 'Request body exceeded maximum size'
              });
            }
            listener(chunk);
          });
        } else {
          originalOn(event, listener);
        }
      };
    }

    next();
  }
};
