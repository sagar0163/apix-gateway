import { describe, it, expect } from 'vitest';
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

  it('should type counters as counter and emit HELP/TYPE once per family', async () => {
    const res = await request(app).get('/metrics');
    const text = res.text;
    expect(text).toContain('# TYPE apix_http_requests_total counter');
    const typeLines = text.match(/# TYPE apix_http_requests_total/g) || [];
    expect(typeLines.length).toBe(1);
    expect(text).toContain('# TYPE apix_http_request_duration_seconds gauge');
  });

  it('should record the actual response status on request finish', async () => {
    const before = await request(app).get('/metrics');
    const beforeText = before.text;
    const requestCount = async (text) => {
      const total = text.match(/^apix_http_requests_total (\d+)$/m);
      return total ? parseInt(total[1], 10) : 0;
    };
    const beforeCount = await requestCount(beforeText);

    const notFound = await request(app).get('/definitely-not-a-real-route-xyz');
    expect(notFound.status).toBeGreaterThanOrEqual(400);

    const after = await request(app).get('/metrics');
    const afterText = after.text;
    expect(await requestCount(afterText)).toBeGreaterThan(beforeCount);

    const statusLabel = `apix_http_requests_total{status="${notFound.status}"} `;
    const statusMatch = afterText.match(new RegExp(`^${statusLabel}(\\d+)$`, 'm'));
    expect(statusMatch).not.toBeNull();
    expect(parseInt(statusMatch[1], 10)).toBeGreaterThan(0);
  });
});
