import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pluginManager } from '../src/plugins/index.js';

let testCounter = 0;

describe('Redis Rate Limiter', () => {
  let app;

  beforeAll(async () => {
    await pluginManager.loadBuiltInPlugins();
  });

  beforeEach(async () => {
    testCounter++;
    app = express();
    app.use(express.json());

    // Reset plugins
    pluginManager.enabledPlugins.clear();
    pluginManager.pluginInstances.clear();

    // Enable rate limiter with forceMemory (no Redis needed for tests)
    pluginManager.enable('rate-limiter-redis', {
      windowMs: 60000,
      maxRequests: 3,
      forceMemory: true,
      keyStrategy: 'ip',
      keyPrefix: `apix:test${testCounter}:`
    });

    app.use(pluginManager.createMiddleware());

    app.get('/test', (req, res) => {
      res.json({ ok: true });
    });
  });

  it('should allow requests under the limit', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('3');
    expect(res.headers['x-ratelimit-remaining']).toBe('2');
  });

  it('should decrement remaining on each request', async () => {
    await request(app).get('/test');
    const res = await request(app).get('/test');
    expect(res.headers['x-ratelimit-remaining']).toBe('1');
  });

  it('should block requests over the limit', async () => {
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too Many Requests');
  });

  it('should set retry-after header when limited', async () => {
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('should set IETF rate limit headers', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toContain('3');
  });

  it('should use ip strategy by default', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

describe('Redis Rate Limiter - Per Route', () => {
  let app;

  beforeEach(async () => {
    testCounter++;
    app = express();
    app.use(express.json());

    pluginManager.enabledPlugins.clear();
    pluginManager.pluginInstances.clear();

    pluginManager.enable('rate-limiter-redis', {
      windowMs: 60000,
      maxRequests: 10,
      forceMemory: true,
      keyStrategy: 'route',
      keyPrefix: `apix:test${testCounter}:`
    });

    // Per-route override
    pluginManager.setRouteConfig('/api/strict', {
      'rate-limiter-redis': { enabled: true, maxRequests: 2 }
    });

    app.use(pluginManager.createMiddleware());

    app.get('/api/normal', (req, res) => res.json({ ok: true }));
    app.get('/api/strict', (req, res) => res.json({ ok: true }));
  });

  it('should use global limit for normal routes', async () => {
    const res = await request(app).get('/api/normal');
    expect(res.status).toBe(200);
  });

  it('should use per-route limit for strict routes', async () => {
    await request(app).get('/api/strict');
    await request(app).get('/api/strict');
    const res = await request(app).get('/api/strict');
    expect(res.status).toBe(429);
  });
});
