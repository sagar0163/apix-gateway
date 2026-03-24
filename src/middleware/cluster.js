// Multi-Cluster Support - Service Mesh Integration
import { logger } from '../utils/logger.js';
import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import os from 'os';

// Cluster configuration
const DEFAULT_OPTIONS = {
  enabled: false,
  workers: os.cpus().length,
  port: 3000,
  host: '0.0.0.0',
  spread: true, // Distribute load evenly
  stickySessions: true,
  healthCheckInterval: 30000,
  maxHealthCheckFailures: 3
};

// Worker state
const workers = new Map();
const healthCheckTimers = new Map();

// Event emitter for cluster events
class ClusterEvents extends EventEmitter {}
const clusterEvents = new ClusterEvents();

// Create worker process
const createWorker = (id, options) => {
  return {
    id,
    pid: process.pid,
    status: 'starting',
    connections: 0,
    memory: 0,
    cpu: 0,
    healthScore: 100,
    healthCheckFailures: 0,
    lastHealthCheck: null,
    startedAt: Date.now(),
    requests: 0,
    errors: 0,
    latency: 0
  };
};

// Health check for workers
const performHealthCheck = async (worker) => {
  try {
    // Simulate health check (in production, would make HTTP request to worker)
    const isHealthy = worker.status === 'ready' && 
                      worker.healthCheckFailures < DEFAULT_OPTIONS.maxHealthCheckFailures &&
                      worker.memory < 1024 * 1024 * 512; // 512MB
    
    worker.lastHealthCheck = Date.now();
    
    if (!isHealthy) {
      worker.healthCheckFailures++;
      logger.warn(`Worker ${worker.id} health check failed: ${worker.healthCheckFailures} times`);
    } else {
      worker.healthCheckFailures = 0;
    }
    
    return isHealthy;
  } catch (err) {
    worker.healthCheckFailures++;
    return false;
  }
};

// Select best worker (least connections, best health)
const selectWorker = (workers) => {
  const availableWorkers = workers.filter(w => 
    w.status === 'ready' && 
    w.healthCheckFailures < DEFAULT_OPTIONS.maxHealthCheckFailures
  );
  
  if (availableWorkers.length === 0) {
    return null;
  }
  
  // Select based on strategy
  if (DEFAULT_OPTIONS.spread) {
    // Least connections
    return availableWorkers.reduce((min, w) => 
      w.connections < min.connections ? w : min
    );
  } else {
    // Random
    return availableWorkers[Math.floor(Math.random() * availableWorkers.length)];
  }
};

// Create load balancer
export const createLoadBalancer = (app, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  if (!config.enabled) {
    logger.info('Load balancer disabled, running in single mode');
    return app;
  }
  
  // Create HTTP server
  const server = http.createServer((req, res) => {
    const worker = selectWorker(Array.from(workers.values()));
    
    if (!worker) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No available workers' }));
      return;
    }
    
    // Increment connection count
    worker.connections++;
    
    // Handle response
    res.on('finish', () => {
      worker.connections--;
    });
    
    res.on('error', () => {
      worker.errors++;
      worker.connections--;
    });
    
    // Forward request to worker (in production, would use IPC or HTTP)
    // For now, just process locally
    app(req, res);
  });
  
  // Initialize workers
  const initWorkers = async () => {
    logger.info(`Initializing ${config.workers} workers...`);
    
    for (let i = 0; i < config.workers; i++) {
      const worker = createWorker(i, config);
      workers.set(i, worker);
      
      // Simulate worker ready
      setTimeout(() => {
        worker.status = 'ready';
        logger.info(`Worker ${i} ready`);
      }, 100 * i);
    }
    
    // Start health checks
    startHealthChecks();
  };
  
  initWorkers();
  
  // Start health check interval
  const startHealthChecks = () => {
    const interval = setInterval(async () => {
      logger.debug('Performing health checks...');
      
      for (const [id, worker] of workers.entries()) {
        const isHealthy = await performHealthCheck(worker);
        
        if (!isHealthy && worker.healthCheckFailures >= DEFAULT_OPTIONS.maxHealthCheckFailures) {
          worker.status = 'unhealthy';
          logger.warn(`Worker ${id} marked as unhealthy`);
          
          clusterEvents.emit('worker:unhealthy', { id, worker });
        } else if (isHealthy && worker.status === 'unhealthy') {
          worker.status = 'ready';
          logger.info(`Worker ${id} recovered`);
          
          clusterEvents.emit('worker:healthy', { id, worker });
        }
      }
    }, config.healthCheckInterval);
    
    healthCheckTimers.set('main', interval);
  };
  
  // Listen for cluster events
  server.on('worker', (worker) => {
    clusterEvents.emit('worker:start', worker);
  });
  
  return server;
};

// Get cluster statistics
export const getClusterStats = () => {
  const workerStats = Array.from(workers.values()).map(w => ({
    id: w.id,
    status: w.status,
    connections: w.connections,
    memory: w.memory,
    cpu: w.cpu,
    healthScore: w.healthScore,
    uptime: Date.now() - w.startedAt,
    requests: w.requests,
    errors: w.errors,
    avgLatency: w.latency
  }));
  
  const totalConnections = workerStats.reduce((sum, w) => sum + w.connections, 0);
  const totalRequests = workerStats.reduce((sum, w) => sum + w.requests, 0);
  const totalErrors = workerStats.reduce((sum, w) => sum + w.errors, 0);
  
  return {
    workers: workerStats.length,
    totalConnections,
    totalRequests,
    totalErrors,
    errorRate: totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : 0,
    status: workerStats.every(w => w.status === 'ready') ? 'healthy' : 'degraded'
  };
};

// Graceful worker shutdown
export const shutdownWorker = async (workerId) => {
  const worker = workers.get(workerId);
  
  if (!worker) {
    throw new Error(`Worker ${workerId} not found`);
  }
  
  logger.info(`Shutting down worker ${workerId}...`);
  
  // Stop accepting new connections
  worker.status = 'draining';
  
  // Wait for connections to drain
  while (worker.connections > 0) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Actually shutdown
  worker.status = 'stopped';
  
  clusterEvents.emit('worker:stopped', { id: workerId });
  
  logger.info(`Worker ${workerId} stopped`);
  
  return { success: true, workerId };
};

// Add new worker (scale up)
export const scaleUp = async () => {
  const newId = workers.size;
  const worker = createWorker(newId, DEFAULT_OPTIONS);
  workers.set(newId, worker);
  
  // Simulate worker ready
  setTimeout(() => {
    worker.status = 'ready';
  }, 100);
  
  logger.info(`Worker ${newId} added (scale up)`);
  clusterEvents.emit('worker:added', { id: newId, worker });
  
  return { success: true, workerId: newId };
};

// Remove worker (scale down)
export const scaleDown = async (workerId) => {
  return shutdownWorker(workerId);
};

// Event emitter for external use
export const cluster = {
  events: clusterEvents,
  on: (event, handler) => clusterEvents.on(event, handler),
  off: (event, handler) => clusterEvents.off(event, handler)
};

export default {
  createLoadBalancer,
  getClusterStats,
  shutdownWorker,
  scaleUp,
  scaleDown,
  cluster
};
