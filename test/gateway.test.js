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
        .expect(200);
      
      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting', async () => {
      // Make multiple requests
      for (let i = 0; i < 5; i++) {
        await request(app).get('/api/test');
      }
      
      // Should be rate limited
      const response = await request(app).get('/api/test');
      expect([429, 503]).toContain(response.status);
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .expect(401);
    });

    it('should accept requests with valid token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);
    });
  });
});
