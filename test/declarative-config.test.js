import { describe, it, expect } from 'vitest';
import { loadDeclarativeConfig, validateConfig, configToInternal } from '../src/utils/declarative.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

describe('Declarative Config', () => {
  it('should load apix.yaml from project root', () => {
    const config = loadDeclarativeConfig(path.join(ROOT, 'apix.yaml'));
    expect(config).not.toBeNull();
    expect(config.version).toBe('1.0');
    expect(config.server.port).toBe(3000);
  });

  it('should validate a valid config', () => {
    const config = {
      version: '1.0',
      server: { port: 3000 },
      routes: [
        { path: '/api', upstream: 'backend' }
      ],
      plugins: { cors: { enabled: true } }
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject config with missing route path', () => {
    const config = {
      routes: [{ upstream: 'backend' }]
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('path');
  });

  it('should reject config with missing route upstream', () => {
    const config = {
      routes: [{ path: '/api' }]
    };

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('upstream');
  });

  it('should convert config to internal format', () => {
    const config = {
      version: '1.0',
      upstreams: {
        users: { url: 'http://localhost:3001' }
      },
      routes: [
        { path: '/users', upstream: 'users', plugins: { 'jwt-auth': { enabled: true } } }
      ],
      plugins: {
        cors: { enabled: true, origin: '*' }
      }
    };

    const internal = configToInternal(config);
    expect(internal.apis['/users']).toBe('http://localhost:3001');
    expect(internal.plugins['cors']).toEqual({ enabled: true, origin: '*' });
    expect(internal.routes['/users'].plugins['jwt-auth']).toEqual({ enabled: true });
  });

  it('should handle missing config file gracefully', () => {
    const config = loadDeclarativeConfig('/nonexistent/apix.yaml');
    expect(config).toBeNull();
  });
});
