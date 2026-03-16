# API Gateway - Advanced Configuration

## Rate Limiting

### Configure Rate Limits

```javascript
// Per-route rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per window
}));
```

### Custom Limits

| Plan | Requests/minute |
|------|-----------------|
| Free | 60 |
| Pro | 600 |
| Enterprise | Unlimited |

## Caching

### Redis Cache

```javascript
const cache = require('apicache');
const redis = require('redis');

const client = redis.createClient();
const cache = cache().options({ redis: client });
```

## Load Balancing

### Strategies

1. **Round Robin** - Default, equal distribution
2. **Least Connections** - Route to server with fewest active connections
3. **IP Hash** - Same IP always goes to same server

## WebSocket Support

```javascript
const wss = new WebSocketServer({
  server,
  path: '/ws'
});
```

## Monitoring

### Metrics

- Request count
- Response time
- Error rate
- Cache hit rate

### Integrations

- Prometheus
- Datadog
- New Relic
