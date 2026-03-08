// WebSocket Support for APIX Gateway
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// WebSocket connections tracking
const connections = new Map();
let wss = null;

// Default configuration
const DEFAULT_OPTIONS = {
  path: '/ws',
  heartbeatInterval: 30000,
  heartbeatTimeout: 60000,
  maxPayload: 16 * 1024 * 1024, // 16MB
  perMessageDeflate: false,
  maxConnections: 100,
  authRequired: false
};

// Create WebSocket server
export const createWebSocketServer = (server, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  wss = new WebSocketServer({
    server,
    path: config.path,
    maxPayload: config.maxPayload,
    perMessageDeflate: config.perMessageDeflate
  });

  logger.info(`WebSocket server initialized at ${config.path}`);

  wss.on('connection', (ws, req) => {
    // Check max connections
    if (connections.size >= config.maxConnections) {
      logger.warn('WebSocket max connections reached');
      ws.close(1013, 'Too many connections');
      return;
    }

    const clientId = crypto.randomUUID();
    const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'];
    
    // Store connection
    connections.set(clientId, {
      ws,
      ip: clientIp,
      connectedAt: Date.now(),
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0
    });

    logger.info(`WebSocket client connected: ${clientId} from ${clientIp}`);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: Date.now()
    }));

    // Heartbeat
    let heartbeatInterval;
    let heartbeatTimeout;

    const startHeartbeat = () => {
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, config.heartbeatInterval);

      ws.on('pong', () => {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
          logger.warn(`WebSocket client ${clientId} heartbeat timeout`);
          ws.close(1008, 'Heartbeat timeout');
        }, config.heartbeatTimeout);
      });
    };

    startHeartbeat();

    // Handle messages
    ws.on('message', (data) => {
      const conn = connections.get(clientId);
      if (conn) {
        conn.messagesReceived++;
        conn.bytesReceived += data.length;
      }

      try {
        const message = JSON.parse(data.toString());
        
        // Handle message types
        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
            
          case 'subscribe':
            // Subscribe to channels
            logger.debug(`Client ${clientId} subscribed to ${message.channel}`);
            break;
            
          case 'broadcast':
            // Broadcast to all clients
            broadcast(message.data, message.channel);
            break;
            
          default:
            // Emit event for custom handlers
            ws.emit('message', message, clientId);
        }
      } catch (err) {
        logger.error('WebSocket message error:', err.message);
      }
    });

    // Handle close
    ws.on('close', (code, reason) => {
      clearInterval(heartbeatInterval);
      clearTimeout(heartbeatTimeout);
      connections.delete(clientId);
      logger.info(`WebSocket client disconnected: ${clientId}, code: ${code}`);
    });

    // Handle errors
    ws.on('error', (err) => {
      logger.error(`WebSocket error for ${clientId}:`, err.message);
    });
  });

  wss.on('error', (err) => {
    logger.error('WebSocket server error:', err);
  });

  return wss;
};

// Broadcast to all connected clients
export const broadcast = (data, channel = null) => {
  const message = JSON.stringify({
    type: 'broadcast',
    channel,
    data,
    timestamp: Date.now()
  });

  let sent = 0;
  for (const [id, conn] of connections.entries()) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
      conn.messagesSent++;
      conn.bytesSent += Buffer.byteLength(message);
      sent++;
    }
  }
  
  return sent;
};

// Send to specific client
export const sendTo = (clientId, data) => {
  const conn = connections.get(clientId);
  if (conn && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(data));
    conn.messagesSent++;
    conn.bytesSent += Buffer.byteLength(JSON.stringify(data));
    return true;
  }
  return false;
};

// Get connection stats
export const getConnectionStats = () => {
  const now = Date.now();
  const stats = [];
  
  for (const [id, conn] of connections.entries()) {
    stats.push({
      id,
      ip: conn.ip,
      connectedFor: now - conn.connectedAt,
      messagesReceived: conn.messagesReceived,
      messagesSent: conn.messagesSent,
      bytesReceived: conn.bytesReceived,
      bytesSent: conn.bytesSent
    });
  }
  
  return {
    total: connections.size,
    connections: stats
  };
};

// Close all connections
export const closeAll = () => {
  for (const [id, conn] of connections.entries()) {
    conn.ws.close(1001, 'Server shutting down');
  }
  connections.clear();
};

// Middleware for WebSocket upgrade handling
export const webSocketMiddleware = (options = {}) => {
  return (req, res, next) => {
    if (req.path === options.path || req.url.startsWith(options.path || '/ws')) {
      // Let WebSocket server handle it
      next();
    } else {
      next();
    }
  };
};

export default {
  createWebSocketServer,
  broadcast,
  sendTo,
  getConnectionStats,
  closeAll,
  webSocketMiddleware
};
