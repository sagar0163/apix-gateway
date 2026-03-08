// Traffic Stats Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  trackBy: 'hour', // 'minute', 'hour', 'day'
  retention: 168, // hours
  windowSize: 60 // seconds for sliding window
};

const stats = {
  requests: new Map(),
  bandwidth: { up: 0, down: 0 },
  statusCodes: {},
  topPaths: [],
  topClients: [],
  startedAt: Date.now()
};

export default {
  name: 'traffic-stats',
  version: '1.0.0',
  description: 'Real-time traffic statistics',
  defaultOptions: DEFAULT_OPTIONS,

  // Get time key
  getTimeKey(trackBy) {
    const now = new Date();
    switch (trackBy) {
      case 'minute':
        return `${now.toISOString().slice(0, 16)}`; // YYYY-MM-DDTHH:MM
      case 'hour':
        return `${now.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
      case 'day':
        return now.toISOString().slice(0, 10); // YYYY-MM-DD
      default:
        return now.toISOString().slice(0, 13);
    }
  },

  // Record request
  record(req, res) {
    const key = this.getTimeKey('hour');
    
    if (!stats.requests.has(key)) {
      stats.requests.set(key, {
        count: 0,
        bandwidth: { up: 0, down: 0 },
        statusCodes: {},
        paths: {},
        clients: {}
      });
    }

    const hourStats = stats.requests.get(key);
    hourStats.count++;
    
    const contentLength = parseInt(res.get('content-length')) || 0;
    const reqLength = parseInt(req.headers['content-length']) || 0;
    
    hourStats.bandwidth.up += reqLength;
    hourStats.bandwidth.down += contentLength;
    stats.bandwidth.up += reqLength;
    stats.bandwidth.down += contentLength;

    const status = res.statusCode;
    hourStats.statusCodes[status] = (hourStats.statusCodes[status] || 0) + 1;
    stats.statusCodes[status] = (stats.statusCodes[status] || 0) + 1;

    // Track paths
    hourStats.paths[req.path] = (hourStats.paths[req.path] || 0) + 1;
    
    // Track clients
    const client = req.ip || 'unknown';
    hourStats.clients[client] = (hourStats.clients[client] || 0) + 1;
  },

  // Get stats
  getStats() {
    const now = Date.now();
    const uptime = now - stats.startedAt;

    // Calculate top paths/clients from last hour
    const keys = Array.from(stats.requests.keys()).sort().slice(-1);
    let paths = {}, clients = {};
    
    for (const key of keys) {
      const s = stats.requests.get(key);
      Object.entries(s.paths).forEach(([p, c]) => {
        paths[p] = (paths[p] || 0) + c;
      });
      Object.entries(s.clients).forEach(([c, n]) => {
        clients[c] = (clients[c] || 0) + n;
      });
    }

    const topPaths = Object.entries(paths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    const topClients = Object.entries(clients)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    const totalRequests = Array.from(stats.requests.values()).reduce((a, s) => a + s.count, 0);

    return {
      uptime: Math.floor(uptime / 1000),
      requests: {
        total: totalRequests,
        rps: (totalRequests / (uptime / 1000)).toFixed(2),
        byStatus: stats.statusCodes
      },
      bandwidth: {
        up: stats.bandwidth.up,
        down: stats.bandwidth.down,
        upMB: (stats.bandwidth.up / 1024 / 1024).toFixed(2),
        downMB: (stats.bandwidth.down / 1024 / 1024).toFixed(2)
      },
      topPaths,
      topClients
    };
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['traffic-stats'] || DEFAULT_OPTIONS;
    
    // Record on response finish
    res.on('finish', () => {
      this.record(req, res);
    });

    // Attach stats to request
    req._trafficStats = {
      getStats: () => this.getStats()
    };

    next();
  }
};
