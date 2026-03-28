# Changelog

All notable changes to APIX Gateway.

## [1.2.0] - 2026-03-28

### Added
- **OpenAPI/Swagger Documentation** - Auto-generated OpenAPI 3.0 spec from plugin config
  - `/admin/openapi.json` — Machine-readable API specification
  - `/admin/openapi.yaml` — YAML format for tools
  - `/docs` — Interactive Swagger UI with dark theme
  - Plugin status badges in the docs UI
  - Full admin API documentation with request/response schemas

## [1.0.0] - 2026-03-08

### Added
- Initial release
- Rate limiting middleware
- Authentication (JWT, API Key)
- Response caching
- Analytics tracking
- Plugin system
- Docker support
- Web UI dashboard

### Features
- **Rate Limiting** - Configurable rate limits per endpoint
- **Authentication** - Multiple auth methods
- **Caching** - In-memory and Redis support
- **Analytics** - Request/response logging
- **Plugins** - Extensible plugin architecture

---

Generated automatically.
