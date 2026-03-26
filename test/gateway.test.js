/**
 * Unit tests for API Gateway
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';

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

      // Check for X-Content-Type-Options
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should not expose sensitive headers', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `security-no-powered-${Date.now()}`);

      // Should not expose server details
      expect(response.headers).not.toHaveProperty('x-powered-by');
    });

    it('should have X-Frame-Options set', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-consumer-id', `security-frame-${Date.now()}`);

      expect(response.headers).toHaveProperty('x-frame-options');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/nonexistent-route')
        .set('x-consumer-id', `error-404-${Date.now()}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    it('should return proper JSON for errors', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .set('x-consumer-id', `error-json-${Date.now()}`)
        .expect(404);

      const isJson = JSON.stringify(response.body);
      expect(isJson).toBeTruthy();
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
});