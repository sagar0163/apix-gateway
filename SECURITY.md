# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.3.x | ✅ Yes |
| < 1.3.0 | ❌ No |

## Reporting a Vulnerability

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, report security issues to:

- **Email**: sagar0163@users.noreply.github.com
- **Subject**: `[SECURITY] APIX Gateway - Brief Description`

### What to Include

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

### Response Timeline

- **Initial response**: Within 48 hours
- **Triage**: Within 1 week
- **Fix release**: Depends on severity

| Severity | Response Time |
|----------|---------------|
| Critical | 24-48 hours |
| High | 1 week |
| Medium | 2 weeks |
| Low | Next release |

### After Fix

- Credit will be given (unless you prefer anonymity)
- CVE will be requested if applicable
- Fix will be included in release notes

## Security Features

APIX Gateway includes:

- Rate limiting (global + per-route)
- JWT authentication
- API key authentication
- HMAC request signing
- IP whitelisting/blocklisting
- Bot detection
- DDoS protection
- Request size limits
- SQL injection detection
- CORS configuration
- Helmet.js security headers

## Best Practices for Deployment

1. **Always change default credentials** in `.env`
2. **Use strong JWT secrets** (min 32 characters)
3. **Enable HTTPS** in production
4. **Set restrictive CORS** origins
5. **Enable rate limiting** on all routes
6. **Monitor logs** for suspicious activity
7. **Keep dependencies updated** (`npm audit`)
