import { describe, it, expect, vi } from 'vitest';
import tokenLimitPlugin from '../src/plugins/builtins/llm-token-limit.js';
import fallbackPlugin from '../src/plugins/builtins/llm-provider-fallback.js';

describe('LLM Plugins', () => {
  describe('Token Limiter', () => {
    it('should allow requests within limit', () => {
      const req = { ip: '127.0.0.1', _pluginOptions: {} };
      const res = {
        set: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      tokenLimitPlugin.handler(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith('X-TokenLimit-Limit', 10000);
    });

    it('should block requests over limit', () => {
      const req = { ip: '127.0.0.2', _pluginOptions: { 'llm-token-limit': { maxTokens: 10, windowMs: 60000 } } };
      const reqPost = { ip: '127.0.0.2', aiContext: { llm: { totalTokens: 20 } }, _pluginOptions: { 'llm-token-limit': { maxTokens: 10, windowMs: 60000 } } };
      
      const res = {
        set: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      // Accumulate tokens
      tokenLimitPlugin.postHandler(reqPost, res, next);

      // Next request from same IP should be blocked
      const nextReq = vi.fn();
      tokenLimitPlugin.handler(req, res, nextReq);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalled();
      expect(nextReq).not.toHaveBeenCalled();
    });
  });

  describe('Provider Fallback', () => {
    it('should skip if not POST or no body', async () => {
      const req = { method: 'GET', _pluginOptions: {} };
      const res = {};
      const next = vi.fn();

      await fallbackPlugin.handler(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should skip if plugin is disabled', async () => {
      const req = { method: 'POST', body: {}, _pluginOptions: { 'llm-provider-fallback': { enabled: false } } };
      const res = {};
      const next = vi.fn();

      await fallbackPlugin.handler(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
