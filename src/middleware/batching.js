// Request Batching Middleware
import { logger } from '../utils/logger.js';

// Batch queue
const batchQueue = new Map();

// Configuration
const DEFAULT_OPTIONS = {
  maxBatchSize: 10,
  maxWaitMs: 50,
  keyGenerator: (req) => req.path,
  batchHandler: null
};

// Process batch
const processBatch = async (key, items, handler) => {
  try {
    const results = await handler(items);
    
    // Send individual responses
    items.forEach((item, index) => {
      if (item.res && !item.res.headersSent) {
        item.res.status(200).json(results[index] || results);
      }
    });
  } catch (err) {
    logger.error('Batch processing error:', err);
    items.forEach((item) => {
      if (item.req && !item.res.headersSent) {
        item.res.status(500).json({ error: 'Batch processing failed' });
      }
    });
  }
};

// Create batching middleware
export const requestBatching = (options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return (req, res, next) => {
    // Only batch POST requests to /batch endpoint
    if (req.path !== '/batch' || req.method !== 'POST') {
      return next();
    }

    const key = config.keyGenerator(req);
    
    if (!batchQueue.has(key)) {
      batchQueue.set(key, {
        items: [],
        timeout: null
      });
    }

    const batch = batchQueue.get(key);
    
    // Add to batch
    batch.items.push({ req, res, body: req.body, timestamp: Date.now() });

    // Process immediately if batch is full
    if (batch.items.length >= config.maxBatchSize) {
      logger.debug(`Batch full for ${key}: ${batch.items.length} items`);
      
      if (batch.timeout) {
        clearTimeout(batch.timeout);
        batch.timeout = null;
      }
      
      const items = batch.items;
      batch.items = [];
      return processBatch(key, items, config.batchHandler);
    }

    // Set timeout for partial batch
    if (!batch.timeout) {
      batch.timeout = setTimeout(() => {
        const items = batch.items;
        batch.items = [];
        batch.timeout = null;
        
        if (items.length > 0) {
          logger.debug(`Batch timeout for ${key}: ${items.length} items`);
          processBatch(key, items, config.batchHandler);
        }
      }, config.maxWaitMs);
    }

    // Don't send response here - it will be sent when batch processes
    // But we need to prevent Express from closing
    res.on('finish', () => {
      // Remove from batch if response sent
      const index = batch.items.findIndex(i => i.res === res);
      if (index > -1) {
        batch.items.splice(index, 1);
      }
    });
  };
};

// Response streaming middleware
export const responseStreaming = (options = {}) => {
  const {
    enable = true,
    threshold = 1024 * 1024 // 1MB
  } = options;

  return (req, res, next) => {
    if (!enable) {
      return next();
    }

    // Only for GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Check Accept-Ranges header
    if (!req.headers.accept || !req.headers.accept.includes('bytes')) {
      return next();
    }

    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.stream = (data, options = {}) => {
      const {
        chunkSize = 64 * 1024, // 64KB chunks
        contentType = 'application/json'
      } = options;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (Array.isArray(data)) {
        res.write('[');
        data.forEach((item, index) => {
          if (index > 0) res.write(',');
          res.write(JSON.stringify(item));
        });
        res.write(']');
      } else if (typeof data === 'object') {
        // Stream object properties
        const keys = Object.keys(data);
        res.write('{');
        keys.forEach((key, index) => {
          if (index > 0) res.write(',');
          res.write(`"${key}":`);
          res.write(JSON.stringify(data[key]));
        });
        res.write('}');
      } else {
        res.write(String(data));
      }

      res.end();
    };

    next();
  };
};

// Server-Sent Events (SSE) middleware
export const sse = (req, res, next) => {
  if (req.path !== '/sse' || req.method !== 'GET') {
    return next();
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial comment to establish connection
  res.write(':connected\n\n');

  // Add to connections (in production, store in a Map)
  const clientId = Date.now();
  logger.debug(`SSE client connected: ${clientId}`);

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  // Cleanup on close
  req.on('close', () => {
    clearInterval(heartbeat);
    logger.debug(`SSE client disconnected: ${clientId}`);
  });

  // Prevent Express from closing response
  req.socket.on('error', () => {
    clearInterval(heartbeat);
  });

  // Don't call next() - we're handling this request
  res.sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
};

export default {
  requestBatching,
  responseStreaming,
  sse
};
