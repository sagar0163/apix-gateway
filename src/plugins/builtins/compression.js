// Compression Plugin (using Node.js built-in zlib)
import zlib from 'zlib';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  threshold: 1024, // Compress if > 1KB
  level: 6, // 1-9 (1=fastest, 9=best)
  memLevel: 5
};

export default {
  name: 'compression',
  version: '1.0.0',
  description: 'Response compression plugin',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.compression || DEFAULT_OPTIONS;
    
    // Check if client accepts compression
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    if (!acceptEncoding.includes('gzip') && !acceptEncoding.includes('deflate')) {
      return next();
    }

    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);

    // Flag to check if we've already transformed
    let transformed = false;

    // Create transform stream
    const createCompressor = (encoding) => {
      const opts = {
        gzip: { level: options.level, memLevel: options.memLevel },
        deflate: { level: options.level }
      };
      return encoding.includes('gzip') 
        ? zlib.createGzip(opts.gzip) 
        : zlib.createDeflate(opts.deflate);
    };

    // Override json
    res.json = (body) => {
      if (transformed) return originalJson(body);
      return res.send(JSON.stringify(body));
    };

    // Override send
    res.send = (body) => {
      if (transformed) return originalSend(body);

      // Skip if too small
      const size = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
      if (size < options.threshold) {
        return originalSend(body);
      }

      // Determine encoding
      const acceptEncoding = req.headers['accept-encoding'] || '';
      const encoding = acceptEncoding.includes('gzip') ? 'gzip' : 'deflate';
      
      // Compress
      const compressor = createCompressor(encoding);
      
      res.set('Content-Encoding', encoding);
      res.removeHeader('Content-Length');

      // Handle compressed stream
      const compressed = Buffer.isBuffer(body) 
        ? compressor.finish(() => body)
        : body;

      if (Buffer.isBuffer(compressed)) {
        originalSend(compressed);
      } else {
        // Stream compression
        transformed = true;
        
        const chunkBuffer = [];
        compressor.on('data', (chunk) => chunkBuffer.push(chunk));
        compressor.on('end', () => {
          res.set('Content-Length', chunkBuffer.reduce((a, b) => a + b.length, 0));
          originalSend(Buffer.concat(chunkBuffer));
        });
        
        if (Buffer.isBuffer(body)) {
          compressor.end(body);
        } else {
          compressor.end(body, 'utf8');
        }
      }
    };

    next();
  }
};
