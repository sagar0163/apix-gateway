# AGENTS.md — Project Instructions for AI Agents

## Project Overview

**APIX Gateway** — A production-ready API Gateway built with Node.js/Express featuring a plugin-based architecture (35+ built-in plugins), admin dashboard, and comprehensive monitoring.

- **Repo**: https://github.com/sagar0163/apix-gateway
- **Stack**: Node.js 18+, Express.js, Redis (optional), Vitest
- **Current Version**: 1.3.0 (in development)
- **Branch Strategy**: main → feature branches → PR → merge

## Skill Routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke `/office-hours`
- Strategy/scope → invoke `/plan-ceo-review`
- Architecture → invoke `/plan-eng-review`
- Design system/plan review → invoke `/design-consultation` or `/plan-design-review`
- Full review pipeline → invoke `/autoplan`
- Bugs/errors → invoke `/investigate`
- QA/testing site behavior → invoke `/qa` or `/qa-only`
- Code review/diff check → invoke `/review`
- Visual polish → invoke `/design-review`
- Ship/deploy/PR → invoke `/ship` or `/land-and-deploy`
- Save progress → invoke `/context-save`
- Resume context → invoke `/context-restore`
- Author a backlog-ready spec/issue → invoke `/spec`

## Development Commands

```bash
# Development
npm run dev          # Start with file watcher
npm start            # Start production

# Testing
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode

# Linting
npm run lint         # Check
npm run lint:fix     # Auto-fix

# Versioning (via CLI)
node src/cli.js version
node src/cli.js release [patch|minor|major|auto]
node src/cli.js changelog
node src/cli.js notes
node src/cli.js validate [config-file]
node src/cli.js sync [config-file]
node src/cli.js dump
node src/cli.js status
```

## Architecture Notes

- **Plugin System**: All functionality via plugins in `src/plugins/builtins/` (35+ plugins)
- **Config**: `plugins.json` for plugin config, `apix.yaml` for declarative config (v1.3+)
- **Admin Dashboard**: `ui/` — dark theme, real-time stats, JWT auth
- **Proxy**: `http-proxy-middleware` with plugin chain
- **Load Balancer**: 5 algorithms + health checks + circuit breaker

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Entry point |
| `src/plugins/index.js` | Plugin manager |
| `src/routes/admin.js` | Admin API |
| `src/routes/proxy.js` | Proxy handler |
| `plugins.json` | Plugin configuration |
| `apix.yaml` | Declarative config (v1.3+) |

## Testing

- Unit tests: `test/*.test.js`
- Integration: `test/integration.test.js`
- Load balancer: `test/load-balancer.test.js`
- Run: `npm test`

## Current Sprint (v1.3.0)

Focus: **Distributed Infrastructure**
- Redis-backed rate limiter (T13-01)
- Declarative YAML config (T13-02)
- OpenTelemetry tracing (T13-03)
- Service discovery (T13-04)
- Webhook events (T13-05)

See `ROADMAP.md` for full task breakdown.

## Coding Standards

- ESM modules (`"type": "module"`)
- ESLint + Prettier (config in `.editorconfig`)
- Conventional commits for auto-versioning
- All plugins follow interface in `src/plugins/index.js`

## Environment

Copy `.env.example` to `.env`:
```env
PORT=3000
JWT_SECRET=your-secret
CORS_ORIGIN=*
RATE_WINDOW_MS=60000
RATE_MAX_REQUESTS=100
REDIS_URL=redis://localhost:6379  # optional
```

## Review Checklist

When reviewing PRs (via `/review`), check:
- [ ] SQL safety (parameterized queries)
- [ ] Race conditions (connection pools, retry logic)
- [ ] LLM output trust boundaries (JSON schema validation)
- [ ] Shell injection (no user input in exec)
- [ ] Enum completeness (new values handled everywhere)
- [ ] Thread safety (psycopg2 pool vs simple connection)
