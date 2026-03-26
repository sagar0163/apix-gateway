import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import app from '../src/index.js';
import pluginManager from '../src/plugins/index.js';

let mockUpstream;

describe('Circuit Breaker Fix Verification', () => {
  beforeAll(async () => {
    mockUpstream = http.createServer((req, res) => {
       if (req.url === '/fail') {
         res.writeHead(500);
         res.end('System Error');
       } else {
         res.writeHead(200);
         res.end('OK');
       }
    });
    await new Promise(resolve => mockUpstream.listen(3015, resolve));

    pluginManager.disable('jwt-auth');
    pluginManager.enable('circuit-breaker', {
      enabled: true,
      failureThreshold: 2,
      timeout: 1000
    });
  });

  afterAll(async () => {
    await new Promise(resolve => mockUpstream.close(resolve));
    pluginManager.disable('circuit-breaker');
  });

  it('should open circuit after threshold of 500 errors', async () => {
    const cb = pluginManager.getPlugin('circuit-breaker');
    cb.reset('test-service');
    
    // First failure
    await request(app).get('/api/test').set('x-upstream-service', 'test-service').set('x-mock-target', 'http://localhost:3015/fail');
    // Note: The proxy middleware uses config.apis. In actual test, we need a matching route.
    // I'll hit the app with a header that triggers 500 in my mock upstream or similar.
    // Since proxy.js uses getApiDefinition, let's make sure /api/test is defined.
  });
});
