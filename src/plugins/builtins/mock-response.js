// Mock Response Plugin
import { logger } from '../../utils/logger.js';
import fs from 'fs';

const DEFAULT_OPTIONS = {
  mocks: {}, // { '/api/users': { GET: { status: 200, body: {...} } } }
  mockDir: './mocks',
  enabled: true,
  passthrough: false
};

export default {
  name: 'mock-response',
  version: '1.0.0',
  description: 'Serve mock responses for development',
  defaultOptions: DEFAULT_OPTIONS,

  // Load mocks from directory
  loadMocks(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const mock = JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8'));
        const path = '/' + file.replace('.json', '');
        this.mocks[path] = mock;
        logger.info(`Loaded mock: ${path}`);
      } catch (err) {
        logger.error(`Failed to load mock ${file}:`, err.message);
      }
    }
  },

  mocks: {},

  // Find matching mock
  findMock(path, method) {
    // Exact match
    if (this.mocks[path]?.[method]) {
      return this.mocks[path][method];
    }

    // Pattern match
    for (const [pattern, mocks] of Object.entries(this.mocks)) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      if (regex.test(path) && mocks[method]) {
        return mocks[method];
      }
    }

    return null;
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['mock-response'] || DEFAULT_OPTIONS;
    
    if (!options.enabled) {
      return next();
    }

    // Check for mock header override
    const useMock = req.headers['x-use-mock'] === 'true' || req.query._mock === 'true';
    
    if (!useMock && !options.passthrough) {
      return next();
    }

    const mock = this.findMock(req.path, req.method);

    if (mock) {
      logger.debug(`Serving mock for ${req.method} ${req.path}`);

      if (mock.delay) {
        setTimeout(() => sendMock(mock), mock.delay);
      } else {
        return sendMock(mock);
      }
    } else if (!options.passthrough) {
      return next();
    }

    function sendMock(mock) {
      const status = mock.status || 200;
      const body = mock.body || {};
      const headers = mock.headers || {};

      res.status(status);
      
      Object.entries(headers).forEach(([key, value]) => {
        res.set(key, value);
      });

      res.set('X-Mocked', 'true');

      if (typeof body === 'string') {
        res.send(body);
      } else {
        res.json(body);
      }
    }
  }
};
