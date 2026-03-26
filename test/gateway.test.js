/**
 * Unit tests for API Gateway
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import app from '../src/index.js';

let mockUpstream;

describe('API Gateway', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `health-${Date.now()}`)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('healthy');
    });

    it('should include uptime', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `uptime-${Date.now()}`)
        .expect(200);

      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
    });

    it('should include plugins info', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `plugins-${Date.now()}`)
        .expect(200);

      expect(response.body).toHaveProperty('plugins');
      expect(Array.isArray(response.body.plugins)).toBe(true);
    });
  });

  describe('GET /health/detailed', () => {
    it('should return detailed health status', async () => {
      const response = await request(app)
        .get('/health/detailed')
        .set('x-consumer-id', `detailed-${Date.now()}`)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('memory');
      expect(response.body).toHaveProperty('cpu');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `security-${Date.now()}`);

      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should not expose sensitive headers', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `security-no-powered-${Date.now()}`);

      expect(response.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('CORS', () => {
    it('should allow cross-origin requests', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://example.com')
        .set('x-consumer-id', `cors-${Date.now()}`);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .expect(401);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting', async () => {
      // The limit is set to 20 for tests.
      for (let i = 0; i < 25; i++) {
        await request(app).get('/api/test');
      }
      
      const response = await request(app).get('/api/test');
      expect([429, 503]).toContain(response.status);
    });
  });

  beforeAll(async () => {
    // Start a mock upstream server on port 3001
    mockUpstream = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Success from upstream' }));
    });
    await new Promise(resolve => mockUpstream.listen(3001, resolve));
  });

  afterAll(async () => {
    if (mockUpstream) {
      await new Promise(resolve => mockUpstream.close(resolve));
    }
  });
});
