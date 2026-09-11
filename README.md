# apix-gateway

> **Modern Node.js API Gateway with rate limiting, authentication, caching, analytics, and plugin architecture**

[![CI](https://github.com/sagar0163/apix-gateway/workflows/CI/badge.svg)](https://github.com/sagar0163/apix-gateway/actions/workflows/ci.yml)
[![Release](https://github.com/sagar0163/apix-gateway/workflows/Release/badge.svg)](https://github.com/sagar0163/apix-gateway/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

---

## ⚡ 5-Minute Quickstart

Get up and running in production in under 5 minutes with our official Docker Compose templates.

```bash
# Clone the repository
git clone https://github.com/sagar0163/apix-gateway.git
cd apix-gateway

# Start the full stack (Gateway + Redis + Dashboard)
docker-compose up -d

# Start with a predefined preset
# Copy the desired preset, e.g., SaaS or E-commerce
cp presets/saas.yaml apix.yaml
docker-compose restart apix-gateway
```

Once started, the gateway is available on `http://localhost:3000` and the dashboard on `http://localhost:3001`.

---

## 🎯 Problem

Building API gateways from scratch is repetitive. You need rate limiting, auth, caching, logging, metrics — every time. Existing solutions are either too heavy (Kong, Traefik) or too minimal.

## 💡 Solution

A **lightweight, programmable API gateway** for Node.js services:

- **Rate limiting** — token bucket, sliding window, distributed (Redis)
- **Authentication** — JWT, API keys, OAuth2, mTLS, custom validators
- **Caching** — response caching with TTL, cache tags, stale-while-revalidate
- **Analytics** — request/response logging, latency histograms, error rates
- **Plugin system** — extend with custom middleware, transformers, routers

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        APIX Gateway                              │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  Router      │  Middleware  │  Plugins     │  Backends          │
│  (trie-based)│  Chain       │  (hot-reload)│  (HTTP/gRPC/TCP)   │
└──────────────┴──────────────┴──────────────┴────────────────────┘
```

## 🚀 Quick Start

```bash
# Install
npm install @apix/gateway

# Create gateway
cat > gateway.js <<'EOF'
import { createGateway } from '@apix/gateway';

const gateway = createGateway({
  port: 8080,
  routes: [
    {
      method: 'GET',
      path: '/api/users',
      handler: async (req) => ({ users: await db.users.findAll() }),
      middleware: ['rateLimit', 'auth', 'cache']
    }
  ],
  plugins: {
    rateLimit: { window: '1m', max: 100 },
    auth: { type: 'jwt', secret: process.env.JWT_SECRET },
    cache: { ttl: '5m', tags: ['users'] }
  }
});

await gateway.start();
console.log('Gateway running on :8080');
EOF

node gateway.js
```

## ⚙️ Configuration

```yaml
# apix.config.yaml
gateway:
  port: 8080
  host: 0.0.0.0
  workers: auto

rateLimit:
  default: { window: "1m", max: 100 }
  redis:
    host: localhost
    port: 6379
    keyPrefix: "apix:rl:"

auth:
  jwt:
    secret: "${JWT_SECRET}"
    algorithms: ["HS256"]
  apiKey:
    header: "X-API-Key"
    lookup: "db"

cache:
  backend: "memory"  # or "redis"
  defaultTTL: "5m"
  maxSize: "100MB"

analytics:
  enabled: true
  exporter: "prometheus"
  port: 9090
```

## 🔌 Plugin Development

```javascript
// plugins/my-plugin.js
export default function myPlugin(gateway) {
  return {
    name: 'my-plugin',
    async onRequest(req, res, next) {
      req.startTime = Date.now();
      next();
    },
    async onResponse(req, res, next) {
      const latency = Date.now() - req.startTime;
      metrics.record('latency', latency);
      next();
    }
  };
}
```

Register:
```javascript
gateway.usePlugin('./plugins/my-plugin');
```

## 📊 Built-in Middleware

| Middleware | Description |
|---|---|
| `rateLimit` | Token bucket / sliding window |
| `auth` | JWT, API Key, OAuth2, mTLS |
| `cache` | Response caching with tags |
| `cors` | Configurable CORS |
| `compression` | gzip/brotli |
| `logging` | Structured JSON logs |
| `metrics` | Prometheus/OpenTelemetry |
| `transform` | Request/response rewriting |
| `circuitBreaker` | Failure isolation |
| `retry` | Exponential backoff |

## 🧪 Testing

```bash
npm test              # Unit tests
npm run test:contract # Contract tests (Pact)
npm run test:load     # Load tests (k6)
```

## 📦 Release

```bash
npm version patch && git push origin main --tags
# GitHub Actions: build → test → release → npm publish
```

## 📄 License

MIT License

---

**Built for high-throughput, low-latency API infrastructure**