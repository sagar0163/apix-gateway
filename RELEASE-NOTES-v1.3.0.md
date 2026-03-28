# APIX Gateway v1.3.0

Released: 2026-03-28

## Release Stats

| Metric | Value |
|--------|-------|
| Commits | 123 |
| Files Changed | 111 |
| Lines Added | +0 |
| Lines Removed | -0 |
| Contributors | 4 |

## Highlights

- **add chaos engineering mock services and orchestrator**
- **add postHandler hook to response-transformer plugin**
- **add postHandler and onError hooks to request-log plugin**
- **add post-proxy and error middleware to app pipeline**
- **add per-route plugin config examples to plugins.json**
- **load per-route plugin configs from plugins.json**
- **add admin API for per-route plugin config management**
- **integrate phase-based plugin execution in proxy route**
- **add lifecycle hooks (preProxy/postProxy/onError) and per-route plugin config**
- **add OpenAPI 3.0 spec generator and Swagger UI**
- **harden trust proxy and optimize json request handling**
- **implement cohort-aware routing and hardened health monitoring**
- **add feature**
- **new enhancement**
- **add advanced middleware - Redis cache, GraphQL subscriptions, cluster support, user-based rate limiting**
- **add Prometheus metrics, WebSocket, and batching support**
- **add admin dashboard UI**
- **add 15+ advanced plugins**
- **add 20+ gateway plugins**
- **add powerful plugin system**
- **initial apix-gateway - modern API Gateway**

## Bug Fixes

- add Redis connection timeout to prevent startup hangs
- use log-line CSS class in chaos log entries
- correct CSS/JS asset paths and add API docs link
- improve dashboard CSS layout and responsiveness
- circuit breaker status hook and state logic hardening
- implement headers-sent check and private IP rejection
- safe HMAC signature verification with timingSafeEqual length checks
- correct arrow function context binding in bot detection
- correct redis skip logic for precise rate limiting
- syntax error in sliding-window-rate-limiter plugin (#2)
- comprehensive test fixes and health endpoint rate limit bypass (#1)
- bug fix
- patch bug
- API gateway improvements

## Performance

- implement middleware caching for high-performance routing
- improve efficiency
- optimize speed
- boost performance
- add lifecycle management and graceful shutdown
- add performance & DDoS protection middleware

## Contributors

- @Sagar Jadhav
- @Sagar Jadhav
- @Sagar Dev
- @Test

## Installation

```bash
npm install apix-gateway
```

```bash
# Or clone and run
git clone https://github.com/sagar0163/apix-gateway.git
cd apix-gateway
npm install
npm start
```

---
*Full diff: [`v1.3.0`](https://github.com/sagar0163/apix-gateway/compare/v1.2.0...v1.3.0)*
