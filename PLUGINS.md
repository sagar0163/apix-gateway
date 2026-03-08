# APIX Gateway Plugins 🔌

APIX Gateway features a powerful plugin system inspired by Kong and Tyk.

## Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `rate-limiter` | Request rate limiting (in-memory or Redis) |
| `jwt-auth` | JWT token authentication |
| `api-key` | API Key authentication |
| `request-transformer` | Transform incoming requests |
| `response-transformer` | Transform outgoing responses |
| `ip-whitelist` | IP filtering (whitelist/blacklist) |
| `cors` | CORS headers management |
| `compression` | Response compression (gzip/deflate) |
| `metrics` | Request metrics collection |
| `circuit-breaker` | Circuit breaker for upstream services |

## Enabling Plugins

### Via plugins.json

Create `plugins.json` in the project root:

```json
{
  "rate-limiter": {
    "enabled": true,
    "maxRequests": 100,
    "windowMs": 60000
  },
  "jwt-auth": {
    "enabled": true,
    "secret": "your-secret",
    "publicPaths": ["/health", "/admin/login"]
  },
  "metrics": {
    "enabled": true
  }
}
```

### Via Admin API

```bash
# Login
curl -X POST http://localhost:3000/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Enable plugin
curl -X POST http://localhost:3000/admin/plugins/rate-limiter/enable \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"options":{"maxRequests":50}}'

# Disable plugin
curl -X POST http://localhost:3000/admin/plugins/rate-limiter/disable \
  -H "Authorization: Bearer <token>"
```

## Writing Custom Plugins

Create a plugin in the `plugins/` directory:

```javascript
// plugins/my-custom-plugin.js
export default {
  name: 'my-custom-plugin',
  version: '1.0.0',
  description: 'My custom plugin',
  defaultOptions: {
    option1: 'default'
  },

  handler: async (req, res, next) => {
    // Your plugin logic
    console.log('Custom plugin running!');
    
    // Continue to next plugin
    next();
  },

  // Optional: error handler
  onError: (err, req, res, next) => {
    res.status(500).json({ error: err.message });
  }
};
```

## Plugin Configuration

Each plugin accepts these options:

### Rate Limiter
```json
{
  "windowMs": 60000,
  "maxRequests": 100,
  "message": "Too Many Requests"
}
```

### JWT Auth
```json
{
  "secret": "your-jwt-secret",
  "algorithm": "HS256",
  "expiresIn": "24h",
  "headerName": "Authorization",
  "publicPaths": ["/health"]
}
```

### Circuit Breaker
```json
{
  "failureThreshold": 5,
  "successThreshold": 2,
  "timeout": 30000,
  "windowMs": 60000
}
```

## Admin API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/plugins` | List all plugins |
| GET | `/admin/plugins/:name` | Get plugin details |
| POST | `/admin/plugins/:name/enable` | Enable plugin |
| POST | `/admin/plugins/:name/disable` | Disable plugin |
| GET | `/admin/metrics` | Get metrics |
| GET | `/admin/circuits` | Get circuit breaker states |
| POST | `/admin/circuits/:service/reset` | Reset circuit |
| GET | `/admin/keys` | List API keys |
| POST | `/admin/keys` | Create API key |
| DELETE | `/admin/keys/:key` | Delete API key |
