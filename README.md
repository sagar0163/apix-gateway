# APIX Gateway 🚀

A modern, fast API Gateway built with Node.js - featuring rate limiting, JWT authentication, caching, and analytics.

## Features

- ⚡ **High Performance** - Built on Express.js with async middleware
- 🔒 **Authentication** - JWT, API Keys, OAuth2 support
- 📊 **Rate Limiting** - Configurable per-client rate limits
- 🔄 **Reverse Proxy** - Dynamic routing to microservices
- 📝 **Request Logging** - Winston logger with file rotation
- 🛡️ **Security** - Helmet.js security headers, CORS support
- 📈 **Admin API** - RESTful management interface

## Quick Start

```bash
# Install dependencies
npm install

# Start the gateway
npm start

# Or use Docker
docker build -t apix-gateway .
docker run -p 3000:3000 apix-gateway
```

## Configuration

Copy `.env.example` to `.env`:

```env
PORT=3000
JWT_SECRET=your-secret-key
CORS_ORIGIN=*
RATE_WINDOW_MS=60000
RATE_MAX_REQUESTS=100
API_USERS=http://localhost:3001
API_ORDERS=http://localhost:3002
API_PRODUCTS=http://localhost:3003
REDIS_URL=redis://localhost:6379
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /admin/login` | Admin login |
| `GET /admin/keys` | List API keys |
| `POST /admin/keys` | Create API key |
| `GET /admin/stats` | Gateway stats |
| `GET /api/*` | Proxy to upstream APIs |

## Architecture

```
Client Request
     ↓
[Rate Limiter] ← Redis (optional)
     ↓
[Auth Check] ← JWT/API Key
     ↓
[Proxy Router] → Target Microservice
     ↓
[Logger] → stdout/file
```

## License

MIT
