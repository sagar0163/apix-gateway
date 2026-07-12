# llm-token-counter Plugin — Acceptance Criteria

## Definition of Done

All criteria below must pass for the spec to be considered complete.

---

## A. Functional Acceptance Criteria

### A1: SSE Parsing — OpenAI Format
- [ ] **AC-01**: Parses `data: {"choices":[{"delta":{"content":"token"}}]}\n\n` → extracts "token"
- [ ] **AC-02**: Handles multiple choices array (picks index 0)
- [ ] **AC-03**: Handles missing `delta.content` gracefully (empty string)
- [ ] **AC-04**: Processes multiple chunks in sequence, accumulates correctly

### A2: SSE Parsing — Anthropic Format
- [ ] **AC-05**: Parses `data: {"type":"content_block_delta","delta":{"text":"token"}}\n\n` → extracts "token"
- [ ] **AC-05b**: Ignores non-delta message types (message_start, message_delta)

### A3: SSE Parsing — Cohere Format
- [ ] **AC-06**: Parses `data: {"text":"token"}\n\n` → extracts "token"

### A4: SSE Parsing — Generic/Unknown Format
- [ ] **AC-07**: Falls back to `token` / `content` / `text` fields in JSON
- [ ] **AC-08**: Treats raw text after `data: ` as token if not valid JSON

### A5: SSE Control Signals
- [ ] **AC-09**: Recognizes `data: [DONE]\n\n` as stream termination
- [ ] **AC-10**: Ignores SSE comments (`: comment\n\n`)
- [ ] **AC-11**: Handles empty `data: \n\n` without error

### A6: Chunk Boundary Handling
- [ ] **AC-12**: Partial token at chunk boundary buffered and completed on next chunk
- [ ] **AC-13**: Partial UTF-8 sequence (e.g., emoji split across chunks) buffered and decoded
- [ ] **AC-14**: Multiple SSE events in single buffer (`data: {...}\n\ndata: {...}\n\n`) all parsed

### A7: Error Recovery
- [ ] **AC-15**: Malformed JSON in chunk logged as error, parser continues with next chunk
- [ ] **AC-16**: Parse errors recorded in `aiContext.errors` with chunk index
- [ ] **AC-17**: Stream completes even with parse errors (unless fatal)

---

## B. Token Counting Acceptance Criteria

### B1: Accuracy
- [ ] **AC-18**: Incremental count matches batch `encoding.encode(fullText).length` ±1 token
- [ ] **AC-19**: Count accurate for ASCII text (1:1 char:token approx)
- [ ] **AC-20**: Count accurate for UTF-8 (emoji, CJK, accented chars)
- [ ] **AC-21**: Count accurate for code/special tokens

### B2: Encoding Support
- [ ] **AC-22**: `cl100k_base` (GPT-4, GPT-3.5) works correctly
- [ ] **AC-23**: `o200k_base` (GPT-4o) works correctly
- [ ] **AC-24**: `p50k_base` (GPT-3) works correctly
- [ ] **AC-25**: `r50k_base` (GPT-2) works correctly
- [ ] **AC-26**: Unknown model falls back to `cl100k_base` with warning log

### B3: Model→Encoding Mapping
- [ ] **AC-27**: `gpt-4o` → `o200k_base`
- [ ] **AC-28**: `gpt-4o-mini` → `o200k_base`
- [ ] **AC-29**: `gpt-4` / `gpt-4-turbo` → `cl100k_base`
- [ ] **AC-30**: `gpt-3.5-turbo` → `cl100k_base`
- [ ] **AC-31**: `claude-3-5-sonnet` / `claude-3-opus` → `cl100k_base`
- [ ] **AC-32**: Per-route `modelEncodings` override works

---

## C. Budget Enforcement Acceptance Criteria

### C1: Headers
- [ ] **AC-33**: `x-ratelimit-limit-tokens` = configured budget
- [ ] **AC-34**: `x-ratelimit-remaining-tokens` = budget - tokensUsed (min 0)
- [ ] **AC-35**: `x-ratelimit-reset-tokens` = Unix timestamp (request start + 60s default)
- [ ] **AC-36**: Headers present on every response (streaming and non-streaming)

### C2: Reject Mode (Default)
- [ ] **AC-37**: When tokensUsed > budget, returns HTTP 429
- [ ] **AC-38**: 429 body: `{error: {message, type: "token_budget_exceeded", code: "RATE_LIMIT_EXCEEDED", details: {budget, used, model}}}`
- [ ] **AC-39**: 429 includes `Retry-After: 60` header
- [ ] **AC-40**: Stream terminates immediately on budget exceed
- [ ] **AC-41**: No partial response sent after 429

### C3: Truncate Mode
- [ ] **AC-42**: When tokensUsed > budget, stops streaming, closes response
- [ ] **AC-43**: Partial response sent up to budget limit
- [ ] **AC-44**: `x-ratelimit-remaining-tokens: 0` on final chunk

### C4: Passthrough Mode
- [ ] **AC-45**: Budget exceeded logs warning, stream continues
- [ ] **AC-46**: `x-ratelimit-remaining-tokens: 0` (negative clamped to 0)
- [ ] **AC-47**: `aiContext.budgetExceeded = true`

### C5: Per-Route Budget
- [ ] **AC-48**: Route config `defaultBudget` overrides global
- [ ] **AC-49**: Route config `onBudgetExceeded` overrides global

---

## D. AIContext Propagation Acceptance Criteria

### D1: Context Structure
- [ ] **AC-50**: `context.aiContext` object exists after onResponse
- [ ] **AC-51**: Contains: `provider`, `model`, `encoding`, `tokensUsed`, `tokensRemaining`, `budget`, `budgetExceeded`, `completionTokens`, `streamChunks`, `firstTokenLatencyMs`, `errors`

### D2: Provider Detection
- [ ] **AC-52**: `provider: 'openai'` for api.openai.com, *.openai.azure.com
- [ ] **AC-53**: `provider: 'anthropic'` for api.anthropic.com
- [ ] **AC-54**: `provider: 'cohere'` for api.cohere.com
- [ ] **AC-55**: `provider: 'azure'` for *.openai.azure.com (distinct from openai)
- [ ] **AC-56**: `provider: 'unknown'` for unrecognized hosts

### D3: Timing
- [ ] **AC-57**: `firstTokenLatencyMs` measured from request start to first token chunk
- [ ] **AC-58**: `streamChunks` counts SSE data chunks processed

### D4: Downstream Access
- [ ] **AC-59**: Subsequent postProxy plugins can read `context.aiContext.tokensUsed`
- [ ] **AC-60**: Context persists for request lifetime

---

## E. Configuration Acceptance Criteria

### E1: Global Config (plugins.json)
- [ ] **AC-61**: Plugin loads with defaults when not in plugins.json
- [ ] **AC-62**: All config options validated at startup
- [ ] **AC-63**: Invalid `encoding` value throws descriptive error
- [ ] **AC-64**: Invalid `onBudgetExceeded` value throws descriptive error

### E2: Per-Route Config (apix.yaml)
- [ ] **AC-65**: Route-level config merges with global (deep merge)
- [ ] **AC-66**: Route can disable plugin: `enabled: false`
- [ ] **AC-67**: Route `modelEncodings` extends/overrides global

### E3: Disabled Plugin
- [ ] **AC-68**: `enabled: false` skips all processing, no headers added
- [ ] **AC-69**: `enabled: false` at route level works

---

## F. Non-Streaming Response Handling

- [ ] **AC-70**: `passthroughNonStreaming: true` (default) → response passed through unmodified
- [ ] **AC-71**: `passthroughNonStreaming: false` → attempts to count tokens from full response body
- [ ] **AC-72**: Non-streaming responses don't add streaming headers

---

## G. Performance Acceptance Criteria

| Metric | Target | Test |
|--------|--------|------|
| **AC-73**: Latency overhead per chunk | < 1ms p99 | Benchmark 10K chunks |
| **AC-74**: Memory per active stream | < 10 KB | Heap snapshot 1000 streams |
| **AC-75**: Concurrent streams | 1000+ | Load test |
| **AC-76**: Token count accuracy vs batch | ±1 token | Fuzz test 10K streams |
| **AC-77**: First token latency impact | < 2ms | Compare with/without plugin |

---

## H. Observability Acceptance Criteria

### H1: Metrics
- [ ] **AC-78**: `apix_llm_tokens_total{provider,model,status}` increments
- [ ] **AC-79**: `apix_llm_token_budget_exceeded_total{provider,model}` increments on exceed
- [ ] **AC-80**: `apix_llm_stream_chunks_total{provider}` increments per chunk
- [ ] **AC-81**: `apix_llm_first_token_latency_ms{provider,model}` records histogram
- [ ] **AC-82**: `apix_llm_token_count_accuracy{provider,model}` gauge (diff vs usage field)

### H2: Logging
- [ ] **AC-83**: Structured JSON log per request with all AIContext fields
- [ ] **AC-84**: Log level: info for success, warn for budget exceeded, error for parse failures
- [ ] **AC-85**: Request ID correlated in logs

---

## I. Test Coverage Acceptance Criteria

### I1: Unit Tests
- [ ] **AC-86**: >90% line coverage on plugin code
- [ ] **AC-87**: >85% branch coverage
- [ ] **AC-88**: All provider parsers tested
- [ ] **AC-89**: All edge cases from Section A tested
- [ ] **AC-90**: Budget enforcement modes tested
- [ ] **AC-91**: Configuration validation tested

### I2: Integration Tests
- [ ] **AC-92**: Full OpenAI stream → correct count, headers, AIContext
- [ ] **AC-93**: Budget exceed (reject) → 429, correct body
- [ ] **AC-94**: Budget exceed (truncate) → partial response
- [ ] **AC-94b**: Budget exceed (passthrough) → warning, completes
- [ ] **AC-95**: Anthropic stream → correct count
- [ ] **AC-96**: Per-route budget override works
- [ ] **AC-97**: Non-streaming passthrough works

### I3: Fuzz Tests
- [ ] **AC-98**: 10,000 synthetic SSE streams complete without crash
- [ ] **AC-99**: Zero unhandled exceptions in fuzz run
- [ ] **AC-100**: Memory stable (no leak) across 10K streams
- [ ] **AC-101**: Token count accuracy ±2 vs batch encoding
- [ ] **AC-102**: 10K streams complete in <30 seconds

---

## J. Security Acceptance Criteria

- [ ] **AC-103**: No request/response bodies logged (only token counts)
- [ ] **AC-104**: Max buffer size enforced (1MB) to prevent DoS
- [ ] **AC-105**: Parse errors don't crash process
- [ ] **AC-106**: Budget limits enforced per-request (no global state leak)

---

## K. Documentation Acceptance Criteria

- [ ] **AC-107**: Plugin README.md exists with all config options
- [ ] **AC-108**: PLUGINS.md updated with llm-token-counter entry
- [ ] **AC-109**: Example apix.yaml route config documented
- [ ] **AC-110**: AIContext schema documented for downstream plugins
- [ ] **AC-111**: Migration notes (none for new plugin)

---

## L. Compatibility Acceptance Criteria

- [ ] **AC-112**: Gateway starts with plugin enabled (no breaking changes)
- [ ] **AC-113**: Existing plugins unaffected (no shared state conflicts)
- [ ] **AC-114**: Works with Express proxy middleware chain
- [ ] **AC-115**: Works with both `plugins.json` and `apix.yaml` config

---

## Acceptance Gate Checklist

| Gate | Criteria | Status |
|------|----------|--------|
| **Code Complete** | All T01-T10 tasks done | ⏳ |
| **Unit Tests Pass** | AC-86 through AC-91 | ⏳ |
| **Integration Tests Pass** | AC-92 through AC-97 | ⏳ |
| **Fuzz Tests Pass** | AC-98 through AC-102 | ⏳ |
| **Performance Meets Targets** | AC-73 through AC-77 | ⏳ |
| **Observability Verified** | AC-78 through AC-85 | ⏳ |
| **Security Reviewed** | AC-103 through AC-106 | ⏳ |
| **Docs Complete** | AC-107 through AC-111 | ⏳ |
| **Compatibility Verified** | AC-112 through AC-115 | ⏳ |

**Overall Status**: ⏳ **NOT READY** — All gates must pass for DONE

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Spec Author | | | |
| Engineering Review | | | |
| QA Lead | | | |
| Product Owner | | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-12 | AI Assistant | Initial spec |