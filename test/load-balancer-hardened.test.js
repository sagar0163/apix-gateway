import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import app from '../src/index.js';
import pluginManager from '../src/plugins/index.js';

let targets = [];
const TARGET_PORTS = [3010, 3011, 3012];

describe('Hardened Load Balancer', () => {
  beforeAll(async () => {
    // Disable other plugins that might interfere (like auth)
    pluginManager.disable('jwt-auth');
    pluginManager.disable('api-key');
    pluginManager.disable('rate-limiter');

    // Start 3 mock upstream servers
    for (const port of TARGET_PORTS) {
      const server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200);
          res.end('OK');
          return;
        }
        
        // Mock specific behavior for testing
        if (req.headers['x-mock-fail'] === 'true') {
          res.writeHead(500);
          res.end('Error from upstream');
          return;
        }

        if (req.headers['x-mock-soft-fail'] === 'true') {
          res.writeHead(200);
          res.end('Blocked count: 1. Please solve captcha.');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Success from port ${port}` }));
      });
      await new Promise(resolve => server.listen(port, resolve));
      targets.push({ server, port, url: `http://localhost:${port}` });
    }

    // Configure and enable Load Balancer plugin manually for testing
    pluginManager.enable('load-balancer', {
      enabled: true,
      strategy: 'round-robin',
      targets: targets.map(t => t.url),
      healthCheck: {
        enabled: true,
        interval: 1000,
        path: '/health',
        verifyResponse: true,
        expectedText: 'OK'
      },
      trustedSuccessPatterns: {
        enabled: true,
        patterns: ['captcha', 'blocked']
      }
    });

    // Also enable retry for testing coordination
    pluginManager.enable('retry', {
      enabled: true,
      retries: 2,
      retryOn: [500],
      coordinateWithLoadBalancer: true,
      retryMethods: ['GET']
    });
  });

  afterAll(async () => {
    for (const t of targets) {
      await new Promise(resolve => t.server.close(resolve));
    }
    pluginManager.disable('load-balancer');
    pluginManager.disable('retry');
  });

  it('should rotate between multiple targets', async () => {
    const responses = [];
    for (let i = 0; i < TARGET_PORTS.length; i++) {
      const res = await request(app).get('/api/test');
      expect(res.status).toBe(200);
      responses.push(res.body.message);
    }

    // Check that we hit all ports
    const uniqueMessages = new Set(responses);
    expect(uniqueMessages.size).toBe(TARGET_PORTS.length);
  });

  it('should detect soft failures (CAPTCHA) even on 200 OK', async () => {
    const lb = pluginManager.getPlugin('load-balancer');
    const initialFailures = lb.targets.reduce((sum, t) => sum + (t.requestFailures || 0), 0);

    // Send request that triggers soft failure
    await request(app)
      .get('/api/test')
      .set('x-mock-soft-fail', 'true');

    const totalFailures = lb.targets.reduce((sum, t) => sum + (t.requestFailures || 0), 0);
    expect(totalFailures).toBeGreaterThan(initialFailures);
  });

  it('should penalize load balancer on retry', async () => {
    const lb = pluginManager.getPlugin('load-balancer');
    const initialFailures = lb.targets.reduce((sum, t) => sum + (t.requestFailures || 0), 0);

    // Send request that will fail and trigger retry
    await request(app)
      .get('/api/test')
      .set('x-mock-fail', 'true');

    const totalFailures = lb.targets.reduce((sum, t) => sum + (t.requestFailures || 0), 0);
    // Should have 1 failure for initial attempt + 2 for retries (total 3 penalisations)
    expect(totalFailures).toBeGreaterThan(initialFailures);
  });

  it('should have health check properties initialized', async () => {
    const lb = pluginManager.getPlugin('load-balancer');
    const targets = lb.targets;
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]).toHaveProperty('healthCheckFailures');
  });
});
