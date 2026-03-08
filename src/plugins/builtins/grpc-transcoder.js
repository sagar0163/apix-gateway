// gRPC Transcoding Plugin
import http2 from 'http2';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  enabled: false,
  protoFile: '',
  services: {},
  timeout: 30000,
  keepAlive: true
};

// Service definitions
const services = new Map();

export default {
  name: 'grpc-transcoder',
  version: '1.0.0',
  description: 'Transcode gRPC to JSON REST API',
  defaultOptions: DEFAULT_OPTIONS,

  // Load proto file (simplified - real implementation needs protobuf.js)
  loadProto(filePath) {
    // In production, use protobuf.js to parse .proto files
    logger.info(`Loading proto file: ${filePath}`);
    return true;
  },

  // Register service
  registerService(name, methods) {
    services.set(name, methods);
  },

  // Transcode HTTP to gRPC
  async transcoder(req, res, next) {
    const options = req._pluginOptions?.['grpc-transcoder'] || DEFAULT_OPTIONS;
    
    // Only handle /grpc/ prefixed routes
    if (!req.path.startsWith('/grpc/')) {
      return next();
    }

    const [, , service, method] = req.path.split('/');
    
    if (!service || !method) {
      return res.status(400).json({ error: 'Invalid gRPC path' });
    }

    const serviceName = `${service.charAt(0).toUpperCase() + service.slice(1)}Service`;
    const upstream = options.services[serviceName];

    if (!upstream) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Create gRPC request
    const client = http2.connect(upstream.url, {
      keepAlive: options.keepAlive
    });

    client.on('error', (err) => {
      logger.error('gRPC connection error:', err.message);
      res.status(502).json({ error: 'Upstream error' });
    });

    const headers = {
      ':method': req.method,
      ':path': `/${serviceName}/${method}`,
      'content-type': 'application/grpc+json',
      'x-grpc-timeout': `${options.timeout}ms`
    };

    // Forward headers
    Object.entries(req.headers).forEach(([key, value]) => {
      if (!key.startsWith(':') && key !== 'host') {
        headers[key] = value;
      }
    });

    const reqData = req.body ? JSON.stringify(req.body) : '';

    const reqStream = client.request(headers);

    let responseData = '';
    
    reqStream.on('response', (responseHeaders) => {
      res.status(responseHeaders[':status'] || 200);
      
      // Forward response headers
      Object.entries(responseHeaders).forEach(([key, value]) => {
        if (!key.startsWith(':')) {
          res.set(key, value);
        }
      });
    });

    reqStream.on('data', (chunk) => {
      responseData += chunk.toString();
    });

    reqStream.on('end', () => {
      client.close();
      
      try {
        const parsed = JSON.parse(responseData);
        res.json(parsed);
      } catch {
        res.send(responseData);
      }
    });

    reqStream.on('error', (err) => {
      client.close();
      logger.error('gRPC request error:', err.message);
      res.status(502).json({ error: err.message });
    });

    if (reqData) {
      reqStream.write(reqData);
    }
    reqStream.end();
  },

  handler(req, res, next) {
    // Route to transcoder
    return this.transcoder(req, res, next);
  }
};
