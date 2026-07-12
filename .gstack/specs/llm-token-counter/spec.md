---
spec_issue_number: 
spec_issue_url: 
spec_filed_at: 
spec_branch: main
spec_plan_mode: inactive
spec_executed: false
spec_worktree_path: 
ttfc_ms: 
tthw_ms: 
---

# llm-token-counter Plugin Specification

## Executive Summary

**Plugin**: `llm-token-counter` — Streaming token counter for LLM responses using tiktoken with SSE parsing, incremental counting, budget enforcement, and AIContext propagation.

**Task ID**: T20-04b (from ROADMAP.md v2.0 AI/LLM Gateway)

**Status**: Ready for implementation

**Scope**: Create a new plugin in `src/plugins/builtins/llm-token-counter.js` that intercepts streaming SSE responses from LLM providers, parses tokens incrementally using tiktoken, enforces token budgets via headers, and propagates token counts via AIContext for downstream plugins.

---

## 1. Problem Statement

APIX Gateway v2.0 adds AI/LLM Gateway capabilities (T20-04). The first plugin needed is a **streaming token counter** that:

1. **Parses SSE streams** from LLM providers (OpenAI, Anthropic, etc.) in real-time
2. **Counts tokens incrementally** using tiktoken without buffering entire responses
3. **Enforces token budgets** via configurable limits and response headers
4. **Propagates token counts** via AIContext for downstream plugins (cost tracking, logging, analytics)
5. **Handles edge cases**: partial tokens at chunk boundaries, malformed SSE, provider-specific formats

**Why now**: Without token counting, we cannot enforce budgets, track costs, or implement model fallback routing (T20-04f). This is the foundation for all AI gateway features.

---

## 2. Scope

### In Scope

| Area | Details |
|------|---------|
| **SSE Parsing** | Parse `data: {...}\n\n` chunks from OpenAI, Anthropic, Azure OpenAI, Cohere, generic SSE |
| **Token Counting** | Incremental tiktoken encoding (cl100k_base, o200k_base, cl100k_base) per model |
| **Budget Enforcement** | `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens` headers; 429 on exceed |
| **AIContext Propagation** | `aiContext.tokensUsed`, `aiContext.tokensRemaining`, `aiContext.model`, `aiContext.provider` |
| **Edge Cases** | Partial tokens at chunk boundaries, malformed SSE, empty chunks, `[DONE]` sentinel |
| **Configuration** | Per-route and global config via plugins.json; model→encoding mapping |
| **Testing** | Unit tests + fuzz testing with 10K synthetic SSE streams |

### Out of Scope

| Area | Reason |
|------|--------|
| Prompt token counting (request body) | Separate plugin (T20-04b companion) |
| Cost calculation / USD tracking | Downstream plugin (cost-tracker) |
| Model fallback routing | T20-04f (depends on this plugin) |
| Response caching | T20-04e (separate plugin) |
| Prompt injection detection | T20-04d (separate plugin) |
| Non-SSE streaming (WebSocket, gRPC) | Future protocol support |

---

## 3. Technical Architecture

### 3.1 Plugin Interface

```javascript
// src/plugins/builtins/llm-token-counter.js
export default {
  name: 'llm-token-counter',
  version: '1.0.0',
  phase: 'postProxy',      // Runs after proxy receives upstream response
  priority: 100,           // Run early in postProxy for budget enforcement
  
  async onResponse(req, res, upstreamRes, context) {
    // Core logic here
  },
  
  // Optional: pre-check request for model/encoding hints
  async onRequest(req, res, context) {
    // Extract model from request body for encoding selection
  }
}
```

### 3.2 Configuration Schema

```json
{
  "llm-token-counter": {
    "enabled": true,
    "encoding": "cl100k_base",           // Default encoding (tiktoken)
    "modelEncodings": {                  // Model → encoding override
      "gpt-4o": "o200k_base",
      "gpt-4": "cl100k_base",
      "claude-3-5-sonnet": "cl100k_base",
      "claude-3-opus": "cl100k_base"
    },
    "defaultBudget": 4096,               // Default token budget per request
    "budgetHeader": "x-ratelimit-limit-tokens",
    "remainingHeader": "x-ratelimit-remaining-tokens",
    "resetHeader": "x-ratelimit-reset-tokens",
    "enforceBudget": true,               // Return 429 when exceeded
    "includePromptTokens": false,        // Count prompt tokens from request
    "providers": {                       // Provider-specific SSE parsing
      "openai": { "format": "openai" },
      "anthropic": { "format": "anthropic" },
      "azure": { "format": "azure-openai" },
      "cohere": { "format": "cohere" }
    },
    "onBudgetExceeded": "reject",        // "reject" | "truncate" | "passthrough"
    "passthroughNonStreaming": true      // Pass non-SSE responses through
  }
}
```

### 3.3 AIContext Schema

```typescript
interface AIContext {
  provider: 'openai' | 'anthropic' | 'azure' | 'cohere' | 'unknown';
  model: string;                         // e.g., "gpt-4o"
  encoding: string;                      // e.g., "o200k_base"
  tokensUsed: number;                    // Incremental count
  tokensRemaining: number;               // Budget - used
  budget: number;                        // Configured limit
  budgetExceeded: boolean;
  promptTokens?: number;                 // If includePromptTokens=true
  completionTokens: number;              // Response tokens counted
  streamChunks: number;                  // SSE chunks processed
  firstTokenLatencyMs?: number;          // Time to first token
  errors: TokenCountError[];             // Parsing errors encountered
}

interface TokenCountError {
  chunkIndex: number;
  error: string;
  recovered: boolean;
}
```

---

## 4. SSE Parsing Specification

### 4.1 Supported Provider Formats

| Provider | SSE Format | Token Field |
|----------|------------|-------------|
| **OpenAI** | `data: {"choices":[{"delta":{"content":"token"}}]}\n\n` | `choices[0].delta.content` |
| **Azure OpenAI** | Same as OpenAI | Same |
| **Anthropic** | `data: {"type":"content_block_delta","delta":{"text":"token"}}\n\n` | `delta.text` |
| **Cohere** | `data: {"text":"token"}\n\n` | `text` |
| **Generic** | `data: {"token":"..."}\n\n` | `token` or `content` or `text` |

### 4.2 Parser State Machine

```
State: IDLE
  ├─ On "data: " → PARSING_JSON
  ├─ On ": " (comment) → IDLE
  ├─ On "\n\n" → IDLE
  └─ On EOF → COMPLETE

State: PARSING_JSON
  ├─ On complete JSON → EXTRACT_TOKEN → IDLE
  ├─ On partial JSON → BUFFER (wait for more)
  ├─ On parse error → RECORD_ERROR → IDLE
  └─ On "[DONE]" → COMPLETE

State: COMPLETE
  └─ Terminal
```

### 4.3 Incremental Token Counting

```javascript
// Pseudocode
let tokenBuffer = '';
let tokenCount = 0;

function processChunk(textChunk) {
  tokenBuffer += textChunk;
  
  // Try to encode complete tokens, keep partial at end
  const tokens = encoding.encode(tokenBuffer);
  
  // Heuristic: if buffer ends mid-token, keep last partial
  // tiktoken doesn't expose partial detection directly
  // Strategy: encode, then re-decode to find boundary
  const decoded = encoding.decode(tokens);
  const lastComplete = decoded.lastIndexOf(textChunk.slice(-1));
  
  if (lastComplete >= 0) {
    const completeText = decoded.slice(0, lastComplete + 1);
    const completeTokens = encoding.encode(completeText);
    tokenCount += completeTokens.length;
    tokenBuffer = tokenBuffer.slice(completeText.length);
  }
  
  return tokenCount;
}
```

### 4.4 Edge Case Handling

| Edge Case | Handling |
|-----------|----------|
| **Partial token at chunk boundary** | Buffer incomplete UTF-8 sequences; tiktoken handles gracefully |
| **Empty `data: \n\n`** | Skip, increment chunk counter |
| **`data: [DONE]\n\n`** | Signal stream complete, finalize counts |
| **Malformed JSON** | Log error, continue parsing next chunk |
| **Missing `data:` prefix** | Treat as raw text (fallback) |
| **Multiple JSON objects in one chunk** | Split by `\n\n`, parse each |
| **SSE comments (`: comment\n\n`)** | Ignore |
| **Provider sends `usage` in final chunk** | Use as ground truth, validate incremental count |
| **Non-streaming response** | Pass through if `passthroughNonStreaming: true` |

---

## 5. Budget Enforcement

### 5.1 Response Headers

| Header | Description | Example |
|--------|-------------|---------|
| `x-ratelimit-limit-tokens` | Total budget for this request | `4096` |
| `x-ratelimit-remaining-tokens` | Tokens remaining | `2048` |
| `x-ratelimit-reset-tokens` | Unix timestamp when budget resets (per-request) | `1700000000` |

### 5.2 Enforcement Modes

| Mode | Behavior |
|------|----------|
| `reject` (default) | Return 429 with `Retry-After` when budget exceeded |
| `truncate` | Stop streaming, close connection, send partial response |
| `passthrough` | Log warning, continue streaming (for monitoring) |

### 5.3 429 Response Format

```json
{
  "error": {
    "message": "Token budget exceeded: 4096/4096 tokens used",
    "type": "token_budget_exceeded",
    "code": "RATE_LIMIT_EXCEEDED",
    "details": {
      "budget": 4096,
      "used": 4096,
      "model": "gpt-4o",
      "retryAfter": 60
    }
  }
}
```

Headers:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
x-ratelimit-limit-tokens: 4096
x-ratelimit-remaining-tokens: 0
x-ratelimit-reset-tokens: 1700000060
```

---

## 6. Integration Points

### 6.1 Plugin Chain Position

```
Request → [plugins] → Proxy → Upstream LLM
                    ↓
Response ← [llm-token-counter] ← [other postProxy] ← Upstream
                    ↓
           AIContext propagated to:
           - cost-tracker (T20-04c)
           - model-fallback (T20-04f)
           - analytics/logger
```

### 6.2 AIContext Propagation

```javascript
// In onResponse, after counting:
context.aiContext = {
  provider: detectProvider(req),
  model: extractModel(req),
  encoding: getEncoding(model),
  tokensUsed: tokenCount,
  tokensRemaining: Math.max(0, budget - tokenCount),
  budget,
  budgetExceeded: tokenCount > budget,
  completionTokens: tokenCount,
  streamChunks: chunkCount,
  firstTokenLatencyMs: Date.now() - firstTokenTime,
  errors: parseErrors
};

// Downstream plugins access via context.aiContext
```

### 6.3 Request-Side Hint (onRequest)

```javascript
async onRequest(req, res, context) {
  // Extract model from request body for encoding selection
  const body = await parseBody(req);
  context.aiContext = {
    model: body.model,
    provider: detectProviderFromUrl(req.url),
    encoding: getEncodingForModel(body.model)
  };
}
```

---

## 7. Configuration Examples

### 7.1 Global Config (plugins.json)

```json
{
  "llm-token-counter": {
    "enabled": true,
    "encoding": "cl100k_base",
    "modelEncodings": {
      "gpt-4o": "o200k_base",
      "gpt-4o-mini": "o200k_base",
      "gpt-4": "cl100k_base",
      "gpt-3.5-turbo": "cl100k_base",
      "claude-3-5-sonnet-20241022": "cl100k_base",
      "claude-3-opus-20240229": "cl100k_base"
    },
    "defaultBudget": 8192,
    "enforceBudget": true,
    "onBudgetExceeded": "reject"
  }
}
```

### 7.2 Per-Route Override (apix.yaml)

```yaml
routes:
  /v1/chat/completions:
    plugins:
      llm-token-counter:
        enabled: true
        defaultBudget: 4096
        modelEncodings:
          "gpt-4o": "o200k_base"
        onBudgetExceeded: "truncate"
  /v1/embeddings:
    plugins:
      llm-token-counter:
        enabled: false  # Not needed for embeddings
```

---

## 8. Dependencies

### 8.1 npm Dependencies

```json
{
  "dependencies": {
    "tiktoken": "^1.0.12",
    "sse-parser": "^0.0.1"   // Or custom lightweight parser
  }
}
```

**tiktoken** is the only required runtime dependency. SSE parsing can use a minimal custom implementation (no heavy deps).

### 8.2 Dev Dependencies

```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

---

## 9. Performance Requirements

| Metric | Target |
|--------|--------|
| **Latency overhead** | < 1ms per chunk (p99) |
| **Memory per stream** | < 10KB buffer |
| **Throughput** | Handle 1000 concurrent streams |
| **Token counting accuracy** | ±1 token vs tiktoken batch count |
| **First token latency impact** | < 2ms added |

---

## 10. Security Considerations

| Risk | Mitigation |
|------|------------|
| **Token budget DoS** | Per-request budgets, configurable limits, rate limiting upstream |
| **Malformed SSE crash** | Defensive parsing, error boundaries, max buffer size (1MB) |
| **Model extraction** | Don't log full prompts/responses; only token counts |
| **Encoding mismatch** | Fallback to cl100k_base, log warning |

---

## 11. Observability

### 10. Observability

### 11.1 Metrics (Prometheus)

| Metric | Type | Labels |
|--------|------|--------|
| `apix_llm_tokens_total` | Counter | `provider`, `model`, `status` (success/exceeded/error) |
| `apix_llm_token_budget_exceeded_total` | Counter | `provider`, `model` |
| `apix_llm_stream_chunks_total` | Counter | `provider` |
| `apix_llm_first_token_latency_ms` | Histogram | `provider`, `model` |
| `apix_llm_token_count_accuracy` | Gauge | `provider`, `model` (diff vs usage field) |

### 11.2 Structured Logs

```json
{
  "level": "info",
  "plugin": "llm-token-counter",
  "requestId": "req-123",
  "provider": "openai",
  "model": "gpt-4o",
  "tokensUsed": 1500,
  "budget": 4096,
  "streamChunks": 45,
  "firstTokenLatencyMs": 120,
  "durationMs": 2340
}
```

---

## 12. Migration / Compatibility

- **New plugin**: No breaking changes to existing plugins
- **Plugins.json**: Add `llm-token-counter` entry; disabled by default
- **apix.yaml**: Optional per-route override
- **AIContext**: New context object; downstream plugins opt-in