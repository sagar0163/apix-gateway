# 🚀 APIX Gateway

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/node-18%2B-orange" alt="Node">
  <img src="https://img.shields.io/badge/express-4.x-red" alt="Express">
</p>

A modern, production-ready **API Gateway** built with Node.js - featuring rate limiting, authentication, caching, analytics, and a beautiful admin dashboard.

## ✨ Features

### 🎯 Core Features
- **Reverse Proxy** - Dynamic routing to microservices
- **Rate Limiting** - Configurable per-client limits
- **Circuit Breaker** - Protect upstream services
- **Load Balancer** - Round-robin, least-connections
- **Request Timeout** - Configurable upstream timeouts
- **Automatic Retry** - Retry failed requests

### 🔐 Authentication (8 methods)
| Plugin | Description |
|--------|-------------|
| JWT Auth | JSON Web Token verification |
| API Keys | Custom API key authentication |
| Basic Auth | HTTP Basic authentication |
| HMAC Auth | HMAC signature verification |
| OAuth2 | OAuth2 token introspection |
| Keycloak | Keycloak/OIDC integration |

### 🛡️ Security
| Plugin | Description |
|--------|-------------|
| CORS | Cross-Origin Resource Sharing |
| IP Whitelist | IP-based access control |
| Bot Detection | Block scrapers/bots |
| Request Size Limit | Body/header size limits |
| Request Validator | JSON Schema validation |

### ⚡ Traffic Control
| Plugin | Description |
|--------|-------------|
| Rate Limiter | Request throttling |
| Quota | Daily/monthly quotas |
| Timeout | Upstream timeout control |
| Retry | Auto-retry on failures |
| Circuit Breaker | Fail-fast protection |

### 🎨 Transformations
| Plugin | Description |
|--------|-------------|
| Request Transformer | Modify incoming requests |
| Response Transformer | Modify outgoing responses |
| Header Enrichment | Add/remove headers |
| URL Rewrite | Rewrite URLs |
| Pagination | Auto-paginate lists |

### 📈 Monitoring
| Plugin | Description |
|--------|-------------|
| Metrics | Request statistics |
| Request Log | Detailed logging |
| Traffic Stats | Real-time analytics |
| Distributed Trace | OpenTelemetry tracing |

### 🔌 Advanced
| Plugin | Description |
|--------|-------------|
| GraphQL Protection | Depth/complexity limits |
| gRPC Transcoder | REST ↔ gRPC conversion |
| WebSocket Proxy | WebSocket support |
| Service Discovery | Consul/etcd/K8s |
| Canary Release | Traffic splitting |
| A/B Testing | Variant testing |
| Mock Response | Development mocks |
| Request Mirror | Mirror to test env |

### 🎨 Admin Dashboard
- **Dark-themed** UI with purple accents
- **Real-time** stats (auto-refresh 5s)
- **Plugin management** - Enable/disable with toggles
- **API Key management** - Create, list, delete
- **Circuit monitoring** - View & reset circuits
- **Responsive design** - Works on mobile
- **Smooth animations** - Modern UX

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/sagar0163/apix-gateway
cd apix-gateway

# Install dependencies
npm install

# Start the gateway
npm start
```

### Access the Gateway

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| Admin API | http://localhost:3000/admin |
| Health | http://localhost:3000/health |
| API Proxy | http://localhost:3000/api/* |

### Default Login
```
Username: admin
Password: admin123
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file:

```env
PORT=3000
JWT_SECRET=your-super-secret-jwt-key
CORS_ORIGIN=*
RATE_WINDOW_MS=60000
RATE_MAX_REQUESTS=100

# Upstream APIs
API_USERS=http://localhost:3001
API_ORDERS=http://localhost:3002
API_PRODUCTS=http://localhost:3003

# Redis (optional)
REDIS_URL=redis://localhost:6379
```

### Plugin Configuration

Edit `plugins.json` to enable/configure plugins:

```json
{
  "rate-limiter": {
    "enabled": true,
    "windowMs": 60000,
    "maxRequests": 100
  },
  "jwt-auth": {
    "enabled": true,
    "secret": "your-secret"
  },
  "metrics": {
    "enabled": true
  }
}
```

## 📡 API Endpoints

### Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/login` | Get JWT token |
| GET | `/admin/stats` | Gateway stats |
| GET | `/admin/plugins` | List plugins |
| POST | `/admin/plugins/:name/enable` | Enable plugin |
| POST | `/admin/plugins/:name/disable` | Disable plugin |
| GET | `/admin/keys` | List API keys |
| POST | `/admin/keys` | Create API key |
| DELETE | `/admin/keys/:key` | Delete API key |
| GET | `/admin/circuits` | Circuit breaker states |
| POST | `/admin/circuits/:service/reset` | Reset circuit |
| GET | `/admin/metrics` | Request metrics |

### Proxy API

| Method | Endpoint | Description |
|--------|----------|-------------|
| * | `/api/*` | Proxy to upstream |

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────┐
│         APIX Gateway                 │
│  ┌────────────────────────────────┐  │
│  │  Plugin Chain                  │  │
│  │  • Auth (JWT/API Key/Basic)   │  │
│  │  • Rate Limiter                │  │
│  │  • Transformer                 │  │
│  │  • Metrics                    │  │
│  └────────────────────────────────┘  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Upstream   │
│  Services   │
└─────────────┘
```

## 📦 Project Structure

```
apix-gateway/
├── src/
│   ├── index.js           # Main entry point
│   ├── plugins/          # Plugin system
│   │   ├── index.js      # Plugin manager
│   │   └── builtins/    # Built-in plugins (35+)
│   ├── middleware/       # Express middleware
│   ├── routes/          # API routes
│   │   ├── admin.js     # Admin API
│   │   └── proxy.js     # Proxy handler
│   └── utils/           # Utilities
│       ├── config.js    # Configuration
│       └── logger.js    # Winston logger
├── ui/                  # Admin dashboard
│   ├── index.html      # Dashboard HTML
│   ├── css/styles.css  # Dark theme styles
│   └── js/app.js       # Dashboard JS
├── plugins.json         # Plugin config
├── package.json
└── README.md
```

## 🔧 Development

```bash
# Development mode
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## 🐳 Docker

```bash
# Build
docker build -t apix-gateway .

# Run
docker run -p 3000:3000 apix-gateway

# With custom config
docker run -p 3000:3000 -v ./plugins.json:/app/plugins.json apix-gateway
```

## 📊 Plugin List (35+)

### Auth Plugins
- `jwt-auth` - JWT verification
- `api-key` - API key validation
- `basic-auth` - HTTP Basic auth
- `hmac-auth` - HMAC signatures
- `oauth2` - OAuth2 introspection
- `keycloak` - Keycloak OIDC

### Security Plugins
- `cors` - CORS headers
- `ip-whitelist` - IP filtering
- `bot-detection` - Block bots
- `request-size` - Size limits
- `request-validator` - Schema validation

### Traffic Plugins
- `rate-limiter` - Rate limiting
- `quota` - Quota management
- `timeout` - Request timeouts
- `retry` - Auto retry
- `circuit-breaker` - Fail protection
- `load-balancer` - Load balancing

### Transform Plugins
- `request-transformer` - Modify requests
- `response-transformer` - Modify responses
- `header-enrichment` - Add headers
- `url-rewrite` - Rewrite URLs

### Performance Plugins
- `cache` - Response caching
- `compression` - Gzip compression

### Monitoring Plugins
- `metrics` - Request stats
- `request-log` - Detailed logging
- `traffic-stats` - Traffic analytics
- `distributed-trace` - Distributed tracing

### Advanced Plugins
- `graphql-protection` - Query limits
- `grpc-transcoder` - gRPC REST conversion
- `websocket` - WebSocket proxy
- `service-discovery` - Service discovery
- `canary-release` - Canary deployments
- `ab-test` - A/B testing
- `mock-response` - Mock responses
- `request-mirror` - Request mirroring

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">Made with ❤️ by <a href="https://github.com/sagar0163">Sagar Jadhav</a></p>
# Updated
# Update
