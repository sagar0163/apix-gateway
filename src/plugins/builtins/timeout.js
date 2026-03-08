// Timeout Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  upstreamTimeout: 30000,
  idleTimeout: 60000,
  headerTimeout: 'x-upstream-timeout'
};

export default {
  name: 'timeout',
  version: '1.0.0',
  description: 'Control upstream timeout settings',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.timeout || DEFAULT_OPTIONS;
    
    // Allow per-request timeout override via header
    const customTimeout = req.headers[options.headerTimeout];
    const timeout = customTimeout ? parseInt(customTimeout) : options.upstreamTimeout;
    
    // Attach timeout to request for use by proxy
    req.upstreamTimeout = timeout;
    req.idleTimeout = options.idleTimeout;
    
    // Set response timeout
    res.setTimeout(timeout, () => {
      logger.error(`Upstream timeout: ${timeout}ms for ${req.path}`);
      if (!res.headersSent) {
        res.status(504).json({
          error: 'Gateway Timeout',
          message: 'Upstream service timed out'
        });
      }
      res.end();
    });

    next();
  }
};
