import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index.js'; // Assuming app is exported from index.js

describe('Metrics Endpoint', () => {
  it('should return Prometheus metrics at /metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('apix_http_requests_total');
  });

  it('should return JSON metrics at /metrics?format=json', async () => {
    const res = await request(app).get('/metrics?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toHaveProperty('requests');
  });
});
