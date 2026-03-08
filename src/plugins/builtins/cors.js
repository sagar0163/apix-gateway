// CORS Plugin
const DEFAULT_OPTIONS = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

export default {
  name: 'cors',
  version: '1.0.0',
  description: 'CORS headers plugin',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.cors || DEFAULT_OPTIONS;
    const origin = req.headers.origin;

    // Set origin
    if (origin) {
      if (options.origin === '*') {
        res.set('Access-Control-Allow-Origin', '*');
      } else if (Array.isArray(options.origin)) {
        res.set('Access-Control-Allow-Origin', options.origin.includes(origin) ? origin : '');
      } else if (typeof options.origin === 'string') {
        res.set('Access-Control-Allow-Origin', options.origin);
      }
    }

    // Set other CORS headers
    if (options.credentials) {
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    
    if (options.exposedHeaders?.length) {
      res.set('Access-Control-Expose-Headers', options.exposedHeaders.join(', '));
    }

    if (options.maxAge) {
      res.set('Access-Control-Max-Age', options.maxAge.toString());
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', options.methods.join(', '));
      res.set('Access-Control-Allow-Headers', options.allowedHeaders.join(', '));
      return res.status(204).send();
    }

    next();
  }
};
