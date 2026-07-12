# llm-token-counter Plugin — Implementation Tasks

## Task Breakdown

| Task ID | Description | Effort | Dependencies | Status |
|---------|-------------|--------|--------------|--------|
| **T01** | Scaffold plugin file and exports | 15min | — | ⏳ |
| **T02** | Add tiktoken dependency to package.json | 5min | T01 | ⏳ |
| **T03** | Implement SSE parser (streaming, incremental) | 45min | T01 | ⏳ |
| **T04** | Implement incremental tiktoken counting | 30min | T02, T03 | ⏳ |
| **T05** | Implement budget enforcement & headers | 30min | T04 | ⏳ |
| **T06** | Implement AIContext propagation | 20min | T05 | ⏳ |
| **T07** | Add provider-specific format handlers | 30min | T03 | ⏳ |
| **T08** | Add configuration schema & validation | 20min | T01 | ⏳ |
| **T09** | Handle edge cases (partial tokens, malformed SSE, [DONE]) | 30min | T03, T04 | ⏳ |
| **T10** | Add per-route config override support | 15min | T08 | ⏳ |
| **T11** | Write unit tests (token counting, SSE parsing) | 45min | T03, T04, T09 | ⏳ |
| **T12** | Write integration tests (full stream flow) | 30min | T05, T06, T11 | ⏳ |
| **T13** | Fuzz test with 10K synthetic SSE streams | 45min | T11 | ⏳ |
| **T14** | Add Prometheus metrics | 20min | T05 | ⏳ |
| **T15** | Add structured logging | 15min | T05 | ⏳ |
| **T16** | Update plugins.json with default config | 10min | T08 | ⏳ |
| **T17** | Update plugins.json schema/docs | 10min | T16 | ⏳ |
| **T18** | Add example apix.yaml route config | 10min | T10 | ⏳ |
| **T19** | Run full test suite & verify | 20min | T12, T13 | ⏳ |
| **T20** | Documentation: README.md for plugin | 20min | T19 | ⏳ |

---

## Task Details

### T01: Scaffold Plugin File
**File**: `src/plugins/builtins/llm-token-counter.js`

```javascript
// Scaffold with:
// - name, version, phase, priority
// - onRequest (extract model/provider hints)
// - onResponse (main SSE parsing + counting)
// - Helper functions: parseSSE, countTokens, enforceBudget
// - Export default plugin object
```

**Acceptance**: File exists, exports valid plugin interface, loads without errors.

---

### T02: Add tiktoken Dependency
**Command**: `cd /home/sagar-jadhav/Documents/my\ project/apix-gateway && npm install tiktoken`

**Files**: `package.json`, `package-lock.json`

**Acceptance**: `tiktoken` appears in dependencies, `require('tiktoken')` works.

---

### T03: Implement SSE Parser
**File**: `src/plugins/builtins/llm-token-counter.js` (internal helper)

```javascript
// parseSSEChunk(buffer, state) → { tokens: string[], state, errors }
// State machine: IDLE → PARSING_JSON → EXTRACT_TOKEN → IDLE
// Handles: data: prefix, \n\n delimiter, [DONE] sentinel, comments
// Returns extracted text tokens ready for counting
```

**Test vectors**:
- OpenAI format: `data: {"choices":[{"delta":{"content":"hello"}}]}\n\n`
- Anthropic format: `data: {"type":"content_block_delta","delta":{"text":"world"}}\n\n`
- Cohere format: `data: {"text":"test"}\n\n`
- `[DONE]` sentinel
- Empty chunks, comments, malformed JSON

**Acceptance**: Parser extracts text from all 3 provider formats + generic.

---

### T04: Implement Incremental Token Counting
**File**: `src/plugins/builtins/llm-token-counter.js`

```javascript
// countTokensIncremental(encoding, textChunk, buffer) → { count, newBuffer }
// Uses tiktoken.encode() + decode round-trip to detect complete tokens
// Buffers partial UTF-8 / partial token at chunk boundary
```

**Algorithm**:
1. Append chunk to buffer
2. Encode full buffer → tokens
3. Decode tokens → reconstructed text
4. Find longest prefix of buffer that matches reconstructed text
5. Count tokens for complete prefix, keep remainder as new buffer

**Edge case**: Buffer ends mid-UTF-8 sequence → keep in buffer.

**Acceptance**: 
- Count matches batch `encoding.encode(fullText).length` ±1
- Handles chunk boundaries correctly (tested in T11)

---

### T05: Implement Budget Enforcement
**File**: `src/plugins/builtins/llm-token-counter.js`

```javascript
// enforceBudget(context, config) → { allowed, headers, response? }
// Reads config.defaultBudget, config.onBudgetExceeded
// Sets response headers: x-ratelimit-limit-tokens, remaining, reset
// Returns 429 response if mode=reject and exceeded
```

**Headers**:
```
x-ratelimit-limit-tokens: 4096
x-ratelimit-remaining-tokens: 2048
x-ratelimit-reset-tokens: 1700000000
```

**Modes**:
- `reject`: 429 with JSON error + Retry-After
- `truncate`: End stream, send partial response
- `passthrough`: Log warning, continue

**Acceptance**: 429 returned with correct headers when budget exceeded in reject mode.

---

### T06: Implement AIContext Propagation
**File**: `src/plugins/builtins/llm-token-counter.js`

```javascript
// In onResponse, after counting:
context.aiContext = {
  provider: 'openai' | 'anthropic' | 'azure' | 'cohere' | 'unknown',
  model: 'gpt-4o',
  encoding: 'o200k_base',
  tokensUsed: 1500,
  tokensRemaining: 2596,
  budget: 4096,
  budgetExceeded: false,
  completionTokens: 1500,
  streamChunks: 45,
  firstTokenLatencyMs: 120,
  errors: []
};
```

**Acceptance**: Downstream plugin can read `context.aiContext.tokensUsed`.

---

### T07: Provider Format Handlers
**File**: `src/plugins/builtins/llm-token-counter.js`

```javascript
const PROVIDER_PARSERS = {
  openai: (json) => json.choices?.[0]?.delta?.content ?? '',
  anthropic: (json) => json.delta?.text ?? '',
  cohere: (json) => json.text ?? '',
  generic: (json) => json.token ?? json.content ?? json.text ?? ''
};

function detectProvider(req) {
  // From URL: api.openai.com, api.anthropic.com, etc.
  // Or from request headers
}
```

**Acceptance**: Correctly extracts text from all 4 formats.

---

### T08: Configuration Schema & Validation
**File**: `src/plugins/builtins/llm-token-counter.js` + test

```javascript
const CONFIG_SCHEMA = {
  enabled: { type: 'boolean', default: true },
  encoding: { type: 'string', default: 'cl100k_base', enum: ['cl100k_base', 'o200k_base', 'p50k_base', 'r50k_base'] },
  modelEncodings: { type: 'object', default: {} },
  defaultBudget: { type: 'number', default: 4096, min: 1 },
  budgetHeader: { type: 'string', default: 'x-ratelimit-limit-tokens' },
  remainingHeader: { type: 'string', default: 'x-ratelimit-remaining-tokens' },
  resetHeader: { type: 'string', default: 'x-ratelimit-reset-tokens' },
  enforceBudget: { type: 'boolean', default: true },
  includePromptTokens: { type: 'boolean', default: false },
  providers: { type: 'object', default: {} },
  onBudgetExceeded: { type: 'string', enum: ['reject', 'truncate', 'passthrough'], default: 'reject' },
  passthroughNonStreaming: { type: 'boolean', default: true }
};
```

**Acceptance**: Invalid config throws descriptive error at startup.

---

### T09: Edge Case Handling
**Test cases to implement**:

| Case | Input | Expected |
|------|-------|----------|
| Partial token at boundary | Chunk 1: "hel", Chunk 2: "lo" | Counts as 1 token "hello" |
| Mid-UTF-8 boundary | Chunk 1: "🎉" (3 bytes), split | Buffers until complete |
| Empty data chunk | `data: \n\n` | Skipped, no error |
| `[DONE]` sentinel | `data: [DONE]\n\n` | Marks complete, finalizes |
| Malformed JSON | `data: {invalid\n\n` | Logs error, continues |
| Multiple JSON per chunk | `data: {...}\n\ndata: {...}\n\n` | Parses both |
| SSE comment | `: keepalive\n\n` | Ignored |
| Missing data: prefix | `{"content":"raw"}\n\n` | Falls back to raw parse |
| Usage in final chunk | `data: {"usage":{"completion_tokens":150}}\n\n` | Validates count matches |

**Acceptance**: All cases pass without crashing; errors logged but stream continues.

---

### T10: Per-Route Config Override
**Files**: Plugin reads `context.routeConfig?.plugins?.['llm-token-counter']`

**Acceptance**: Route-level config in apix.yaml overrides global plugins.json.

---

### T11: Unit Tests
**File**: `test/plugins/llm-token-counter.test.js`

**Test suites**:
- `parseSSEChunk()` — all provider formats + edge cases
- `countTokensIncremental()` — accuracy vs batch encoding
- `enforceBudget()` — all 3 modes, header values
- `detectProvider()` — URL/hostname matching
- `getEncodingForModel()` — model→encoding mapping

**Coverage target**: >90% lines, >85% branches.

---

### T12: Integration Tests
**File**: `test/integration/llm-token-counter.test.js`

**Scenarios**:
1. Full OpenAI stream → counts tokens, sets headers, AIContext populated
2. Budget exceeded (reject mode) → 429 returned, stream stopped
3. Budget exceeded (truncate mode) → stream ends early, partial response
4. Budget exceeded (passthrough) → warning logged, stream completes
5. Anthropic stream format → correct counting
6. Non-streaming response → passthrough (no counting)
7. Per-route budget override → different limit applied

---

### T13: Fuzz Testing (10K SSE Streams)
**File**: `test/fuzz/llm-token-counter.fuzz.test.js`

**Generator**: Creates random SSE streams with:
- Random chunk sizes (1-500 chars)
- Random token content (ASCII, UTF-8, emoji)
- Random provider formats mixed
- Random malformed chunks (10%)
- Random `[DONE]` positions
- Stream lengths: 10-5000 chunks

**Validation**:
- No crashes, no unhandled exceptions
- Token count matches batch encoding of full reconstructed text ±2
- Memory stays bounded (<10MB per stream)
- All 10K streams complete in <30 seconds

**Command**: `npm test -- test/fuzz/llm-token-counter.fuzz.test.js`

---

### T14: Prometheus Metrics
**File**: `src/plugins/builtins/llm-token-counter.js` (import metrics from `src/middleware/metrics.js`)

```javascript
metrics.increment('apix_llm_tokens_total', { provider, model, status });
metrics.histogram('apix_llm_first_token_latency_ms', latency, { provider, model });
metrics.gauge('apix_llm_token_count_accuracy', diff, { provider, model });
```

**Acceptance**: Metrics exposed at `/metrics` endpoint.

---

### T15: Structured Logging
**File**: `src/plugins/builtins/llm-token-counter.js` (use `context.logger`)

```javascript
context.logger.info({
  plugin: 'llm-token-counter',
  requestId: context.requestId,
  provider: 'openai',
  model: 'gpt-4o',
  tokensUsed: 1500,
  budget: 4096,
  streamChunks: 45,
  firstTokenLatencyMs: 120,
  durationMs: 2340
});
```

**Acceptance**: Logs appear in structured JSON format.

---

### T16: Update plugins.json
**File**: `plugins.json`

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

**Acceptance**: Gateway starts with plugin enabled; config validated.

---

### T17: Update Plugin Schema/Docs
**File**: `PLUGINS.md` (or similar docs)

Add entry for `llm-token-counter` with config reference.

---

### T18: Example apix.yaml Route Config
**File**: `apix.yaml.example` or docs

```yaml
routes:
  /v1/chat/completions:
    plugins:
      llm-token-counter:
        defaultBudget: 4096
        onBudgetExceeded: truncate
```

---

### T19: Full Test Suite Run
**Command**: `npm test`

**Acceptance**: All tests pass (unit + integration + fuzz). No regressions.

---

### T20: Plugin README
**File**: `src/plugins/builtins/llm-token-counter.README.md`

Sections:
- Overview
- Configuration
- AIContext schema
- Provider formats
- Budget enforcement modes
- Metrics
- Example usage

---

## Dependency Graph

```
T01 ──┬── T02 ── T04 ── T05 ── T06
      │         │         │
      ├── T03 ──┤         ├── T14
      │         │         ├── T15
      ├── T08 ── T10      │
      │         │         │
      └── T07 ──┤         │
                │         │
      T09 ──────┴── T11 ──┤
                          ├── T12 ── T13 ── T19 ── T20
                          │
                          └── T16 ── T17 ── T18
```

---

## Estimated Total Effort

| Category | Tasks | Effort |
|----------|-------|--------|
| Core Implementation | T01-T10 | ~4.5 hours |
| Testing | T11-T13 | ~2 hours |
| Observability | T14-T15 | ~35 min |
| Configuration/Docs | T16-T18, T20 | ~50 min |
| **Total** | **20 tasks** | **~8 hours** |

---

## Parallelization Opportunities

- **T02** can run immediately after T01
- **T03** and **T08** can run in parallel after T01
- **T14, T15** can run after T05 (independent of T06-T10)
- **T16, T17, T18** can run after T08 (independent of T09-T15)
- **T11** depends on T03, T04, T09 — can start once those are done
- **T12** depends on T05, T06, T11
- **T13** depends on T11 (fuzz uses unit test helpers)

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| tiktoken encoding mismatch | Medium | High | Extensive model→encoding map; fallback to cl100k_base; log warnings |
| SSE parsing bugs with real providers | Medium | High | Fuzz test with 10K streams; test against recorded real streams |
| Memory leak in streaming buffer | Low | High | Max buffer size (1MB); explicit buffer clear on stream end |
| Performance overhead | Low | Medium | Benchmark with 1000 concurrent streams; target <1ms/chunk |
| Budget race condition | Low | High | Atomic check in enforceBudget; test concurrent requests |