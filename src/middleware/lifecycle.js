// Graceful Shutdown Handler
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// Store for cleanup functions
const cleanupFunctions = [];

// Register cleanup function
export const registerCleanup = (name, fn) => {
  cleanupFunctions.push({ name, fn });
  logger.info(`Registered cleanup: ${name}`);
};

// Graceful shutdown
export const gracefulShutdown = async (server, options = {}) => {
  const {
    forceTimeout = 10000, // 10 seconds
    signals = ['SIGTERM', 'SIGINT', 'SIGQUIT']
  } = options;

  const shutdown = async (signal) => {
    logger.warn(`Received ${signal}, starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Set connection timeout
    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, forceTimeout);

    // Run cleanup functions
    for (const { name, fn } of cleanupFunctions) {
      try {
        logger.info(`Running cleanup: ${name}`);
        await fn();
        logger.info(`Cleanup complete: ${name}`);
      } catch (err) {
        logger.error(`Cleanup failed for ${name}:`, err.message);
      }
    }

    // Clear force timeout
    clearTimeout(forceExit);

    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  // Register signal handlers
  signals.forEach(signal => {
    process.on(signal, () => shutdown(signal));
  });

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });
};

// Health check for load balancers
export const healthCheck = (options = {}) => {
  const {
    checkFunction = null,
    timeout = 5000
  } = options;

  return async (req, res) => {
    try {
      // Basic health check
      let status = 'healthy';
      let checks = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      };

      // Run custom health check if provided
      if (checkFunction) {
        const result = await Promise.race([
          checkFunction(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), timeout)
          )
        ]);
        
        checks = { ...checks, ...result };
      }

      // Check memory usage
      const memUsage = process.memoryUsage();
      const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (heapUsedPercent > 90) {
        status = 'unhealthy';
        checks.memoryIssue = `Heap usage at ${heapUsedPercent.toFixed(1)}%`;
      }

      // Check event loop lag
      const start = Date.now();
      await new Promise(resolve => setImmediate(resolve));
      const lag = Date.now() - start;
      
      if (lag > 100) {
        status = 'degraded';
        checks.eventLoopLag = lag;
      }

      const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json({
        status,
        ...checks
      });
    } catch (err) {
      res.status(503).json({
        status: 'unhealthy',
        error: err.message
      });
    }
  };
};

// Request ID middleware for tracing
export const requestId = (options = {}) => {
  const {
    headerName = 'x-request-id',
    generator = () => crypto.randomUUID()
  } = options;

  return (req, res, next) => {
    const id = req.headers[headerName.toLowerCase()] || generator();
    req.id = id;
    req.requestId = id;
    res.setHeader(headerName, id);
    next();
  };
};

// Memory leak detection (for development)
export const memoryLeakDetector = (options = {}) => {
  const {
    interval = 60000, // Check every minute
    threshold = 100 * 1024 * 1024 // 100MB growth
  } = options;

  if (process.env.NODE_ENV === 'production') return;

  let lastMemory = process.memoryUsage();
  
  setInterval(() => {
    const current = process.memoryUsage();
    const heapGrowth = current.heapUsed - lastMemory.heapUsed;
    
    if (heapGrowth > threshold) {
      logger.warn(`Potential memory leak detected: ${(heapGrowth / 1024 / 1024).toFixed(2)}MB growth`);
      logger.warn('Memory stats:', {
        heapUsed: (current.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
        heapTotal: (current.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
        rss: (current.rss / 1024 / 1024).toFixed(2) + 'MB'
      });
    }
    
    lastMemory = current;
  }, interval);
};

export default {
  registerCleanup,
  gracefulShutdown,
  healthCheck,
  requestId,
  memoryLeakDetector
};
