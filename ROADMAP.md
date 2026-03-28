# APIX Gateway - Development Roadmap

## Vision
Build a production-ready, enterprise-grade API Gateway that competes with Kong, Tyk, and Apigee — with modern features, excellent developer experience, and robust security.

## Competitive Position
| Feature | APIX | Kong | Tyk | Apigee |
|---------|------|------|-----|--------|
| Core Proxy | ✅ | ✅ | ✅ | ✅ |
| Plugin System | ✅ | ✅ | ✅ | ✅ |
| Distributed Rate Limiting | ❌ | ✅ | ✅ | ✅ |
| OAuth2 Full | ❌ | ✅ | ✅ | ✅ |
| OpenTelemetry | ❌ | ✅ | ✅ | ✅ |
| Declarative Config | ❌ | ✅ | ✅ | ✅ |
| Service Discovery | ❌ | ✅ | ✅ | ✅ |
| Developer Portal | ❌ | ✅ | ✅ | ✅ |
| gRPC Proxy | ❌ | ✅ | ✅ | ✅ |
| Clustering/HA | ❌ | ✅ | ✅ | ✅ |
| AI/LLM Gateway | ❌ | ✅ | ❌ | ❌ |

---

## Version 1.1.0 - Foundation & Performance ✅

| Task | Status |
|------|--------|
| Redis Integration | ✅ Done |
| HTTP/2 Support | ✅ Done |
| Structured Logging | ✅ Done |
| Enhanced Health Checks | ✅ Done |
| Load Balancer Fixes | ✅ Done |

---

## Version 1.2.0 - Developer Experience ✅

| Task | Status |
|------|--------|
| OpenAPI/Swagger Auto-Generation | ✅ Done |
| Swagger UI (Dark Theme) | ✅ Done |
| Dashboard CSS/Layout Fixes | ✅ Done |
| Per-Route Plugin Config | ✅ Done |
| Plugin Lifecycle Hooks (preProxy/postProxy/onError) | ✅ Done |
| Admin API for Route Management | ✅ Done |

---

## Version 1.3.0 - Distributed Infrastructure

### Goals: Production-grade distributed features

#### T13-01: Redis-Backed Rate Limiter (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T13-01a | Create `src/plugins/builtins/rate-limiter-redis.js` | 30min | ⏳ |
| T13-01b | Implement Lua script for atomic INCR+EXPIRE | 30min | ⏳ |
| T13-01c | Add sliding window rate limiting with sorted sets | 1hr | ⏳ |
| T13-01d | Add per-route rate limit override support | 30min | ⏳ |
| T13-01e | Add rate limit headers (X-RateLimit-*) | 15min | ⏳ |
| T13-01f | Add fallback to in-memory when Redis unavailable | 30min | ⏳ |
| T13-01g | Write tests for Redis rate limiter | 30min | ⏳ |
| T13-01h | Update plugins.json with Redis rate limiter config | 15min | ⏳ |

#### T13-02: Declarative YAML Configuration (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T13-02a | Create `src/utils/declarative.js` config loader | 30min | ⏳ |
| T13-02b | Define YAML schema for routes, plugins, upstreams | 30min | ⏳ |
| T13-02c | Add validation with Joi schema | 30min | ⏳ |
| T13-02d | Add `apix validate` CLI command | 15min | ⏳ |
| T13-02e | Add `apix sync` CLI command (apply config) | 30min | ⏳ |
| T13-02f | Add `apix dump` CLI command (export current config) | 15min | ⏳ |
| T13-02g | Create example `apix.yaml` config file | 15min | ⏳ |
| T13-02h | Write tests for declarative config | 30min | ⏳ |

#### T13-03: OpenTelemetry Tracing (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T13-03a | Install `@opentelemetry/sdk-node` and dependencies | 10min | ⏳ |
| T13-03b | Create `src/middleware/tracing.js` middleware | 30min | ⏳ |
| T13-03c | Implement W3C Trace Context propagation | 30min | ⏳ |
| T13-03d | Add span creation for plugin phases | 30min | ⏳ |
| T13-03e | Add span creation for upstream proxy calls | 15min | ⏳ |
| T13-03f | Add Jaeger/Zipkin exporter configuration | 15min | ⏳ |
| T13-03g | Add trace ID to response headers | 15min | ⏳ |
| T13-03h | Write tests for tracing middleware | 30min | ⏳ |

#### T13-04: Service Discovery (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T13-04a | Create `src/discovery/` directory structure | 10min | ⏳ |
| T13-04b | Implement DNS-based service discovery | 30min | ⏳ |
| T13-04c | Implement static file-based discovery | 15min | ⏳ |
| T13-04d | Add health check integration with discovery | 30min | ⏳ |
| T13-04e | Add service instance caching with TTL | 15min | ⏳ |
| T13-04f | Write tests for service discovery | 30min | ⏳ |

#### T13-05: Webhook Events (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T13-05a | Create `src/webhooks/` event emitter | 15min | ⏳ |
| T13-05b | Define event types (circuit-open, rate-limit, health-change) | 15min | ⏳ |
| T13-05c | Implement HTTP webhook delivery with retries | 30min | ⏳ |
| T13-05d | Add webhook config to plugins.json | 15min | ⏳ |
| T13-05e | Add admin API for webhook management | 15min | ⏳ |
| T13-05f | Write tests for webhook delivery | 30min | ⏳ |

#### T13-06: Enhanced Admin UI (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T13-06a | Add route config page to dashboard | 30min | ⏳ |
| T13-06b | Add webhook management page | 15min | ⏳ |
| T13-06c | Add tracing viewer page | 30min | ⏳ |
| T13-06d | Add real-time metrics charts | 30min | ⏳ |
| T13-06e | Add dark/light theme toggle | 15min | ⏳ |

---

## Version 1.4.0 - Security Hardening

### Goals: Enterprise security features

#### T14-01: mTLS Support (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T14-01a | Create `src/middleware/mtls.js` | 30min | ⏳ |
| T14-01b | Add CA certificate configuration | 15min | ⏳ |
| T14-01c | Implement client certificate validation | 30min | ⏳ |
| T14-01d | Add per-route mTLS requirement | 15min | ⏳ |
| T14-01e | Add certificate revocation list (CRL) support | 30min | ⏳ |
| T14-01f | Write tests for mTLS | 30min | ⏳ |

#### T14-02: OAuth2 Full Implementation (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T14-02a | Implement authorization code flow | 1hr | ⏳ |
| T14-02b | Implement token introspection endpoint | 30min | ⏳ |
| T14-02c | Implement PKCE support | 30min | ⏳ |
| T14-02d | Add refresh token handling | 30min | ⏳ |
| T14-02e | Add scope validation per route | 15min | ⏳ |
| T14-02f | Write tests for OAuth2 flows | 45min | ⏳ |

#### T14-03: WAF Rules (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T14-03a | Create `src/plugins/builtins/waf.js` | 15min | ⏳ |
| T14-03b | Add SQL injection detection patterns | 15min | ⏳ |
| T14-03c | Add XSS detection patterns | 15min | ⏳ |
| T14-03d | Add path traversal detection | 15min | ⏳ |
| T14-03e | Add request body inspection | 15min | ⏳ |
| T14-03f | Add IP reputation checking | 30min | ⏳ |
| T14-03g | Add WAF stats to admin dashboard | 15min | ⏳ |
| T14-03h | Write tests for WAF rules | 30min | ⏳ |

#### T14-04: API Key Rotation (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T14-04a | Add expiration field to API keys | 15min | ⏳ |
| T14-04b | Add key rotation schedule | 15min | ⏳ |
| T14-04c | Add auto-expiry background job | 30min | ⏳ |
| T14-04d | Add key rotation notification webhook | 15min | ⏳ |
| T14-04e | Write tests for key rotation | 15min | ⏳ |

---

## Version 1.5.0 - Observability & Analytics

### Goals: Full monitoring & alerting

#### T15-01: Prometheus Metrics Enhancement (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T15-01a | Add per-route request counters | 15min | ⏳ |
| T15-01b | Add per-route latency histograms | 15min | ⏳ |
| T15-01c | Add upstream health gauge | 15min | ⏳ |
| T15-01d | Add plugin execution duration metrics | 15min | ⏳ |
| T15-01e | Add circuit breaker state gauge | 15min | ⏳ |

#### T15-02: Grafana Dashboard (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T15-02a | Create Grafana dashboard JSON | 30min | ⏳ |
| T15-02b | Add request rate panel | 15min | ⏳ |
| T15-02c | Add latency percentile panel | 15min | ⏳ |
| T15-02d | Add error rate panel | 15min | ⏳ |
| T15-02e | Add upstream health panel | 15min | ⏳ |
| T15-02f | Add docker-compose with Grafana + Prometheus | 15min | ⏳ |

#### T15-03: Error Tracking (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T15-03a | Create error grouping logic | 15min | ⏳ |
| T15-03b | Add error fingerprinting | 15min | ⏳ |
| T15-03c | Add error rate alerting | 15min | ⏳ |
| T15-03d | Add error dashboard page | 30min | ⏳ |

---

## Version 1.6.0 - Advanced Routing

#### T16-01: Canary Releases (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T16-01a | Enhance canary-release plugin with weight-based routing | 30min | ⏳ |
| T16-01b | Add header-based canary override | 15min | ⏳ |
| T16-01c | Add cookie-based session stickiness | 15min | ⏳ |
| T16-01d | Add canary metrics to dashboard | 15min | ⏳ |

#### T16-02: A/B Testing (LOW)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T16-02a | Enhance ab-test plugin with experiment tracking | 15min | ⏳ |
| T16-02b | Add experiment result metrics | 15min | ⏳ |
| T16-02c | Add experiment dashboard page | 15min | ⏳ |

---

## Version 1.7.0 - Protocol Support

#### T17-01: gRPC Transcoding (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T17-01a | Install `@grpc/proto-loader` | 10min | ⏳ |
| T17-01b | Create `src/plugins/builtins/grpc-transcoder.js` full impl | 1hr | ⏳ |
| T17-01c | Add proto file parsing and validation | 30min | ⏳ |
| T17-01d | Add REST → gRPC request mapping | 30min | ⏳ |
| T17-01e | Add gRPC → REST response mapping | 30min | ⏳ |
| T17-01f | Write tests for gRPC transcoding | 30min | ⏳ |

#### T17-02: GraphQL Proxy (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T17-02a | Create GraphQL-aware proxy handler | 30min | ⏳ |
| T17-02b | Add query depth limiting | 15min | ⏳ |
| T17-02c | Add query complexity analysis | 15min | ⏳ |
| T17-02d | Add per-operation rate limiting | 15min | ⏳ |

#### T17-03: Server-Sent Events (LOW)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T17-03a | Add SSE proxy support | 15min | ⏳ |
| T17-03b | Add SSE connection tracking | 15min | ⏳ |

---

## Version 2.0.0 - Enterprise & AI

### Goals: Large-scale deployment & AI gateway

#### T20-01: Developer Portal (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T20-01a | Create portal React app skeleton | 30min | ⏳ |
| T20-01b | Add API catalog page (from OpenAPI spec) | 30min | ⏳ |
| T20-01c | Add interactive API playground | 30min | ⏳ |
| T20-01d | Add API key self-service | 15min | ⏳ |
| T20-01e | Add usage analytics for developers | 15min | ⏳ |
| T20-01f | Add OAuth app registration | 30min | ⏳ |

#### T20-02: Kubernetes Ingress Controller (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T20-02a | Create K8s CRD for APIXRoute | 30min | ⏳ |
| T20-02b | Implement ingress controller loop | 1hr | ⏳ |
| T20-02c | Add automatic TLS via cert-manager | 30min | ⏳ |
| T20-02d | Add Helm chart | 30min | ⏳ |

#### T20-03: Clustering & HA (HIGH)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T20-03a | Implement node discovery via gossip protocol | 1hr | ⏳ |
| T20-03b | Add config sync between nodes | 30min | ⏳ |
| T20-03c | Add distributed state via Redis Cluster | 30min | ⏳ |
| T20-03d | Add leader election for background jobs | 30min | ⏳ |

#### T20-04: AI/LLM Gateway (HIGH - Differentiator)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T20-04a | Create `src/plugins/builtins/llm-proxy.js` | 30min | ⏳ |
| T20-04b | Add token counting per provider (OpenAI, Anthropic, etc) | 30min | ⏳ |
| T20-04c | Add cost tracking and budget limits | 30min | ⏳ |
| T20-04d | Add prompt injection detection | 30min | ⏳ |
| T20-04e | Add response caching for identical prompts | 15min | ⏳ |
| T20-04f | Add model fallback routing | 30min | ⏳ |
| T20-04g | Add streaming response proxy | 30min | ⏳ |

#### T20-05: RBAC & Multi-Tenancy (MEDIUM)
| Subtask | Description | Effort | Status |
|---------|-------------|--------|--------|
| T20-05a | Add role definitions (admin, developer, viewer) | 15min | ⏳ |
| T20-05b | Add permission checks on admin API | 15min | ⏳ |
| T20-05c | Add tenant isolation for API keys | 30min | ⏳ |
| T20-05d | Add audit log for all admin actions | 15min | ⏳ |

---

## Quick Reference

### Status Labels
- ⏳ Pending: Not started
- 🔄 In Progress: Currently working on
- ✅ Done: Completed
- 🚧 Blocked: Waiting on dependency
- ❌ Cancelled: Dropped from scope

### Effort Levels
- **15min**: Quick win, single file change
- **30min**: Small feature, 1-2 files
- **1hr**: Medium feature, 2-4 files
- **2hr+**: Large feature, multiple files + tests

### Task ID Format
- `T{version}-{sequence}` — e.g., `T13-01a` = Version 1.3.0, Task 1, Subtask a

---

## Contributing

1. Pick a task from the roadmap (e.g., `T13-01a`)
2. Create a branch: `feature/T13-01a-redis-rate-limiter`
3. Implement with tests
4. Update task status in this roadmap
5. Submit PR

---

*Last Updated: 2026-03-28*
*Maintainer: Sagar Jadhav*
*Repository: https://github.com/sagar0163/apix-gateway*
