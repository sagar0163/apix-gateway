// WebSocket Proxy Plugin
import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  enabled: false,
  path: '/ws',
  target: '',
  heartbeat: 30000,
  maxPayload: 16777216 // 16MB
};

export default {
  name: 'websocket',
  version: '1.0.0',
  description: 'WebSocket proxy support',
  defaultOptions: DEFAULT_OPTIONS,

  // Create WebSocket proxy
  createProxy(server, options) {
    const wss = new WebSocketServer({ 
      noServer: true,
      maxPayload: options.maxPayload 
    });

    wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      logger.info(`WebSocket client connected: ${clientIp}`);

      // Create upstream connection
      const upstream = new (require('ws'))(options.target, {
        headers: {
          ...req.headers,
          'x-forwarded-for': clientIp
        }
      });

      upstream.on('open', () => {
        logger.debug('Upstream WebSocket connected');
      });

      upstream.on('message', (data) => {
        if (ws.readyState === 1) { // OPEN
          ws.send(data);
        }
      });

      upstream.on('close', () => {
        logger.debug('Upstream WebSocket closed');
        ws.close();
      });

      upstream.on('error', (err) => {
        logger.error('Upstream WebSocket error:', err.message);
        ws.close();
      });

      // Client messages
      ws.on('message', (data) => {
        if (upstream.readyState === 1) { // OPEN
          upstream.send(data);
        }
      });

      ws.on('close', () => {
        logger.debug('Client WebSocket closed');
        upstream.close();
      });

      ws.on('error', (err) => {
        logger.error('Client WebSocket error:', err.message);
        upstream.close();
      });

      // Heartbeat
      if (options.heartbeat) {
        const interval = setInterval(() => {
          if (ws.readyState === 1 && upstream.readyState === 1) {
            ws.ping();
            upstream.ping();
          } else {
            clearInterval(interval);
          }
        }, options.heartbeat);
      }
    });

    // Handle upgrade
    server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith(options.path)) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    return wss;
  }
};
