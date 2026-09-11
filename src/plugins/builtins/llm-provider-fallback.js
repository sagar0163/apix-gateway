import { logger } from '../../utils/logger.js';
import { Readable } from 'stream';

const DEFAULT_OPTIONS = {
  enabled: true,
  primaryProvider: 'openai',
  fallbackProvider: 'anthropic',
  fallbackModel: 'claude-3-opus-20240229',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || ''
};

export default {
  name: 'llm-provider-fallback',
  version: '1.0.0',
  description: 'Fallback from one LLM provider to another on failure',
  defaultOptions: DEFAULT_OPTIONS,

  handler: async (req, res, next) => {
    const options = req._pluginOptions?.['llm-provider-fallback'] || DEFAULT_OPTIONS;
    if (!options.enabled) return next();

    if (req.method !== 'POST' || !req.body) {
      return next();
    }

    try {
      const primaryTarget = req._target || 'https://api.openai.com';
      const primaryUrl = `${primaryTarget}${req.path}`;
      
      const primaryHeaders = { ...req.headers };
      delete primaryHeaders['host'];
      delete primaryHeaders['content-length'];

      logger.info(`[llm-fallback] Trying primary provider at ${primaryUrl}`);
      const primaryRes = await fetch(primaryUrl, {
        method: 'POST',
        headers: primaryHeaders,
        body: JSON.stringify(req.body)
      });

      if (primaryRes.ok || (primaryRes.status < 500 && primaryRes.status !== 429)) {
        res.status(primaryRes.status);
        primaryRes.headers.forEach((val, key) => res.set(key, val));
        if (primaryRes.body) {
          return Readable.fromWeb(primaryRes.body).pipe(res);
        } else {
          return res.end();
        }
      }

      logger.warn(`[llm-fallback] Primary failed with status ${primaryRes.status}. Falling back to ${options.fallbackProvider}`);

      if (options.fallbackProvider === 'anthropic') {
        const anthropicUrl = 'https://api.anthropic.com/v1/messages';
        
        const anthropicBody = {
          model: options.fallbackModel,
          max_tokens: req.body.max_tokens || 1024,
          messages: req.body.messages || []
        };
        const systemMsg = anthropicBody.messages.find(m => m.role === 'system');
        if (systemMsg) {
          anthropicBody.system = systemMsg.content;
          anthropicBody.messages = anthropicBody.messages.filter(m => m.role !== 'system');
        }

        const anthropicHeaders = {
          'Content-Type': 'application/json',
          'x-api-key': options.anthropicApiKey,
          'anthropic-version': '2023-06-01'
        };

        const fallbackRes = await fetch(anthropicUrl, {
          method: 'POST',
          headers: anthropicHeaders,
          body: JSON.stringify(anthropicBody)
        });

        res.status(fallbackRes.status);
        fallbackRes.headers.forEach((val, key) => res.set(key, val));
        if (fallbackRes.body) {
          return Readable.fromWeb(fallbackRes.body).pipe(res);
        } else {
          return res.end();
        }
      }
      
      res.status(primaryRes.status);
      primaryRes.headers.forEach((val, key) => res.set(key, val));
      if (primaryRes.body) {
        return Readable.fromWeb(primaryRes.body).pipe(res);
      } else {
        return res.end();
      }

    } catch (err) {
      logger.error('[llm-fallback] Error during fallback processing', err);
      return res.status(502).json({ error: 'Gateway Error during LLM fallback', details: err.message });
    }
  }
};
