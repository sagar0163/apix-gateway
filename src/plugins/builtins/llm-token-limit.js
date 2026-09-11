import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  windowMs: 60000,
  maxTokens: 10000,
  keyPrefix: 'tokenlimit:',
  message: 'Token Limit Exceeded'
};

const store = new Map();

export default {
  name: 'llm-token-limit',
  version: '1.0.0',
  description: 'Rate limiting based on LLM token usage',
  defaultOptions: DEFAULT_OPTIONS,

  // preProxy
  handler: (req, res, next) => {
    const options = req._pluginOptions?.['llm-token-limit'] || DEFAULT_OPTIONS;
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.resetTime) {
      record = {
        tokensUsed: 0,
        resetTime: now + options.windowMs
      };
      store.set(key, record);
    }

    res.set('X-TokenLimit-Limit', options.maxTokens);
    res.set('X-TokenLimit-Remaining', Math.max(0, options.maxTokens - record.tokensUsed));
    res.set('X-TokenLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.tokensUsed >= options.maxTokens) {
      logger.warn(`Token limit exceeded for ${key}`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: options.message,
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }

    next();
  },

  // postProxy
  postHandler: (req, res, next) => {
    const options = req._pluginOptions?.['llm-token-limit'] || DEFAULT_OPTIONS;
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    
    // Attempt to read totalTokens from aiContext populated by llm-token-counter
    const totalTokens = req.aiContext?.llm?.totalTokens || 0;
    
    if (totalTokens > 0) {
      let record = store.get(key);
      if (!record || now > record.resetTime) {
        record = {
          tokensUsed: 0,
          resetTime: now + options.windowMs
        };
        store.set(key, record);
      }
      record.tokensUsed += totalTokens;
    }
    
    next();
  }
};
