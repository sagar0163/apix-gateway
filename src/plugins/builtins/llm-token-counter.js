/**
 * llm-token-counter Plugin
 * Streaming token counter for LLM responses using tiktoken with SSE parsing,
 * incremental counting, budget enforcement, and AIContext propagation.
 */

import tiktoken from 'tiktoken';

const DEFAULT_OPTIONS = {
  enabled: true,
  // Default encoding (tiktoken)
  encoding: 'cl100k_base',
  // Encoding per model (falls back to default)
  modelEncodings: {
    'gpt-4o': 'o200k_base',
    'gpt-4o-mini': 'o200k_base',
    'gpt-4': 'cl100k_base',
    'gpt-3.5-turbo': 'cl100k_base',
    'claude-3-5-sonnet': 'cl100k_base',
    'claude-3-opus': 'cl100k_base',
    'claude-3-haiku': 'cl100k_base',
  },
  // Default token budget per request
  defaultBudget: 4096,
  // Budget enforcement: 'reject' | 'truncate' | 'passthrough'
  budgetMode: 'reject',
  // Budget headers to add to response
  headers: {
    budgetLimit: 'X-LLM-Budget-Limit',
    budgetUsed: 'X-LLM-Budget-Used',
    budgetRemaining: 'X-LLM-Budget-Remaining',
    budgetExceeded: 'X-LLM-Budget-Exceeded',
    tokensPrompt: 'X-LLM-Tokens-Prompt',
    tokensCompletion: 'X-LLM-Tokens-Completion',
    tokensTotal: 'X-LLM-Tokens-Total',
  },
  // Buffer limits
  maxBufferSize: 1024 * 1024, // 1MB
  maxChunksPerStream: 10000,
  // Performance
  firstTokenLatencyTracking: true,
  // Passthrough non-streaming responses
  passthroughNonStreaming: true,
  // Provider-specific SSE parsing
  providers: {
    openai: {
      dataField: 'choices[0].delta.content',
      doneMarker: '[DONE]',
      usageField: 'usage',
    },
    anthropic: {
      dataField: 'delta.text',
      doneMarker: null, // Uses message_stop event
      usageField: 'usage',
    },
    azure: {
      dataField: 'choices[0].delta.content',
      doneMarker: '[DONE]',
      usageField: 'usage',
    },
    cohere: {
      dataField: 'text',
      doneMarker: null,
      usageField: 'meta.billed_units',
    },
  },
};

class SSEParser {
  constructor() {
    this.buffer = '';
    this.chunkCount = 0;
  }

  /**
   * Parse incoming SSE chunk, yielding complete events
   * @param {string} chunk - Raw SSE data chunk
   * @returns {Array<Object>} Parsed SSE events
   */
  parse(chunk) {
    this.buffer += chunk;
    this.chunkCount++;

    const events = [];
    const lines = this.buffer.split('\n');

    // Keep last line as buffer (may be incomplete)
    this.buffer = lines.pop() || '';

    let currentEvent = {};

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          currentEvent.done = true;
        } else {
          try {
            currentEvent.data = JSON.parse(data);
          } catch {
            currentEvent.rawData = data;
          }
        }
        // Emit event if we have data
        if (currentEvent.data !== undefined || currentEvent.done) {
          events.push({ ...currentEvent });
          currentEvent = {};
        }
      } else if (line.startsWith('id:')) {
        currentEvent.id = line.slice(3).trim();
      } else if (line.startsWith('retry:')) {
        currentEvent.retry = parseInt(line.slice(6).trim(), 10);
      } else if (line === '') {
        // Empty line = event boundary
        if (Object.keys(currentEvent).length > 0) {
          events.push({ ...currentEvent });
          currentEvent = {};
        }
      }
    }

    return events;
  }

  /**
   * Get any remaining buffered data as a final event
   */
  flush() {
    if (this.buffer.trim()) {
      try {
        return [{ data: JSON.parse(this.buffer.trim()) }];
      } catch {
        return [{ rawData: this.buffer.trim() }];
      }
    }
    return [];
  }

  /**
   * Check if we've exceeded chunk limits
   */
  checkLimits(maxChunks) {
    return this.chunkCount <= maxChunks;
  }
}

class TokenCounter {
  constructor(encodingName) {
    try {
      this.encoder = tiktoken.get_encoding(encodingName);
    } catch {
      this.encoder = tiktoken.get_encoding('cl100k_base');
    }
    this.partialBuffer = '';
    this.tokenCount = 0;
  }

  /**
   * Count tokens incrementally, handling partial UTF-8 at chunk boundaries
   * @param {string} text - Text chunk to count
   * @returns {number} Tokens counted in this chunk
   */
  countIncremental(text) {
    if (!text) return 0;

    // Prepend any partial from previous chunk
    const fullText = this.partialBuffer + text;

    // Find last complete character boundary
    let low = 0;
    let high = fullText.length;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const prefix = fullText.slice(0, mid);
      const prefixTokens = this.encoder.encode(prefix);
      const fullTokens = this.encoder.encode(fullText);

      if (prefixTokens.length < fullTokens.length) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const lastCompleteEnd = low;

    // Tokens counted = tokens from complete portion
    const completeText = fullText.slice(0, lastCompleteEnd);
    const completeTokens = this.encoder.encode(completeText);
    const newTokens = completeTokens.length - this.tokenCount;

    // Update state
    this.tokenCount += newTokens;
    this.partialBuffer = fullText.slice(lastCompleteEnd);

    return newTokens;
  }

  /**
   * Flush any remaining partial buffer
   */
  flush() {
    if (this.partialBuffer) {
      const tokens = this.encoder.encode(this.partialBuffer);
      const newTokens = tokens.length - this.tokenCount;
      this.tokenCount += newTokens;
      this.partialBuffer = '';
      return newTokens;
    }
    return 0;
  }

  /**
   * Get total token count so far
   */
  getTotal() {
    return this.tokenCount;
  }

  /**
   * Reset counter
   */
  reset() {
    this.tokenCount = 0;
    this.partialBuffer = '';
  }

  /**
   * Count tokens in complete text (for non-streaming or final verification)
   */
  countComplete(text) {
    if (!text) return 0;
    return this.encoder.encode(text).length;
  }
}

function getProviderConfig(provider, options) {
  return options.providers[provider] || options.providers.openai;
}

function getEncodingForModel(model, options) {
  return options.modelEncodings[model] || 'cl100k_base';
}

function extractField(obj, path) {
  // Simple path resolver: "choices[0].delta.content" -> obj.choices[0].delta.content
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function extractUsage(obj, path) {
  if (!path) return null;
  return extractField(obj, path);
}

export default {
  name: 'llm-token-counter',
  version: '1.0.0',
  description: 'Streaming token counter for LLM responses with budget enforcement and AIContext propagation',
  defaultOptions: DEFAULT_OPTIONS,
  phase: 'postProxy', // Runs after proxy receives upstream response
  priority: 100, // Run early in postProxy for budget enforcement

  async handler(req, res, next) {
    const options = req._pluginOptions?.['llm-token-counter'] || DEFAULT_OPTIONS;
    if (!options.enabled) return next();

    // Skip if not an LLM request (no provider detected)
    const provider = req.headers['x-llm-provider'] || 'openai';
    const model = req.headers['x-llm-model'] || 'gpt-4o';
    const budget = parseInt(req.headers['x-llm-budget'] || '', 10) || options.defaultBudget;
    const budgetMode = req.headers['x-llm-budget-mode'] || options.budgetMode;

    const providerConfig = getProviderConfig(provider, options);
    const encodingName = getEncodingForModel(model, options);

    const tokenCounter = new TokenCounter(encodingName);
    const sseParser = new SSEParser();

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let budgetExceeded = false;
    let firstTokenTime = null;
    const startTime = Date.now();
    let streamEnded = false;

    // Initialize AIContext on request
    req.aiContext = req.aiContext || {};
    req.aiContext.llm = {
      provider,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      cached: false,
      injectionDetected: false,
      piiRedacted: false,
      modelFallback: null,
    };

    // Extract prompt tokens from request body if available
    if (req.body && typeof req.body === 'object') {
      const messages = req.body.messages || [];
      const promptText = messages.map(m => m.content || '').join('\n');
      promptTokens = tokenCounter.countComplete(promptText);
      req.aiContext.llm.promptTokens = promptTokens;
    }

    const headers = options.headers;

    // Override res.write to intercept streaming chunks
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    let responseBuffer = '';

    res.write = (chunk, encoding, callback) => {
      if (streamEnded) return originalWrite(chunk, encoding, callback);

      // Check chunk limit
      if (!sseParser.checkLimits(options.maxChunksPerStream)) {
        console.warn('[llm-token-counter] Max chunks per stream exceeded');
        return originalWrite(chunk, encoding, callback);
      }

      const chunkStr = chunk.toString('utf8');
      responseBuffer += chunkStr;

      // Check buffer size
      if (responseBuffer.length > options.maxBufferSize) {
        console.warn('[llm-token-counter] Buffer size exceeded, passing through');
        responseBuffer = '';
        return originalWrite(chunk, encoding, callback);
      }

      // Parse SSE events
      const events = sseParser.parse(chunkStr);

      for (const event of events) {
        if (event.done) {
          streamEnded = true;
          continue;
        }

        if (!event.data) continue;

        // Track first token latency
        if (firstTokenTime === null && event.data) {
          firstTokenTime = Date.now();
          req.aiContext.llm.firstTokenLatencyMs = firstTokenTime - startTime;
        }

        // Extract completion text based on provider
        let textChunk = null;

        if (event.event === 'message_delta' && provider === 'anthropic') {
          textChunk = extractField(event.data, providerConfig.dataField);
        } else if (event.event === 'completion' || !event.event) {
          textChunk = extractField(event.data, providerConfig.dataField);
        } else if (event.event === 'message_stop' && provider === 'anthropic') {
          // Anthropic sends usage on message_stop
          const usage = extractUsage(event.data, providerConfig.usageField);
          if (usage) {
            promptTokens = usage.input_tokens || promptTokens;
            completionTokens = usage.output_tokens || completionTokens;
          }
          streamEnded = true;
        } else if (event.event === 'usage' || (event.data.usage && provider !== 'anthropic')) {
          // OpenAI/Azure send usage in final event or separate usage event
          const usage = extractUsage(event.data, providerConfig.usageField);
          if (usage) {
            promptTokens = usage.prompt_tokens || usage.input_tokens || promptTokens;
            completionTokens = usage.completion_tokens || usage.output_tokens || completionTokens;
          }
        }

        if (textChunk) {
          // Count tokens incrementally
          const newTokens = tokenCounter.countIncremental(textChunk);
          completionTokens += newTokens;
          totalTokens = promptTokens + completionTokens;

          // Update AIContext
          req.aiContext.llm.completionTokens = completionTokens;
          req.aiContext.llm.totalTokens = totalTokens;

          // Budget enforcement
          if (budget > 0 && totalTokens > budget && !budgetExceeded) {
            budgetExceeded = true;
            req.aiContext.llm.budgetExceeded = true;

            // Add budget exceeded header
            res.setHeader(headers.budgetExceeded, 'true');

            if (budgetMode === 'reject') {
              // Stop streaming, send error
              streamEnded = true;
              return originalWrite(
                JSON.stringify({ error: 'Token budget exceeded', budget, used: totalTokens }) + '\n',
                encoding,
                callback
              );
            } else if (budgetMode === 'truncate') {
              // Close stream gracefully
              streamEnded = true;
              res.setHeader(headers.budgetExceeded, 'true');
            }
            // passthrough: just add header, continue
          }
        }
      }

      // Pass through to client
      return originalWrite(chunk, encoding, callback);
    };

    res.end = (chunk, encoding, callback) => {
      if (!streamEnded) {
        // Flush any remaining tokens
        const flushTokens = tokenCounter.flush();
        completionTokens += flushTokens;
        totalTokens = promptTokens + completionTokens;

        req.aiContext.llm.completionTokens = completionTokens;
        req.aiContext.llm.totalTokens = totalTokens;
        streamEnded = true;
      }

      // Add response headers (only if not already flushed to the client)
      if (!res.headersSent) {
        if (budget > 0) {
          res.setHeader(headers.budgetLimit, budget.toString());
          res.setHeader(headers.budgetUsed, totalTokens.toString());
          res.setHeader(headers.budgetRemaining, Math.max(0, budget - totalTokens).toString());
        }
        res.setHeader(headers.tokensPrompt, promptTokens.toString());
        res.setHeader(headers.tokensCompletion, completionTokens.toString());
        res.setHeader(headers.tokensTotal, totalTokens.toString());
      }

      // Update AIContext with final values
      req.aiContext.llm.promptTokens = promptTokens;
      req.aiContext.llm.completionTokens = completionTokens;
      req.aiContext.llm.totalTokens = totalTokens;

      // Calculate cost estimate (rough, per 1K tokens)
      const costPer1k = {
        'gpt-4o': 0.005, 'gpt-4o-mini': 0.00015, 'gpt-4': 0.03,
        'claude-3-opus': 0.015, 'claude-3-sonnet': 0.003, 'claude-3-haiku': 0.00025,
      };
      const modelCost = costPer1k[model] || 0.01;
      const costUSD = (totalTokens / 1000) * modelCost;
      req.aiContext.llm.costUSD = costUSD;

      return originalEnd(chunk, encoding, callback);
    };

    next();
  },
};

