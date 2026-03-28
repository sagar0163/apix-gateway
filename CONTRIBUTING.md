# Contributing to APIX Gateway

Thank you for your interest in contributing to APIX Gateway! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/apix-gateway.git
   cd apix-gateway
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a branch:
   ```bash
   git checkout -b feature/T13-01a-redis-rate-limiter
   ```

## Development Workflow

### Branch Naming

Use the task ID from [ROADMAP.md](./ROADMAP.md):

| Type | Format | Example |
|------|--------|---------|
| Feature | `feature/T{ver}-{seq}-{name}` | `feature/T13-01a-redis-rate-limiter` |
| Bug Fix | `fix/{description}` | `fix/rate-limit-header-bug` |
| Docs | `docs/{description}` | `docs/api-reference` |
| Test | `test/{description}` | `test/auth-integration` |

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add Redis rate limiter
fix(auth): correct JWT validation for expired tokens
docs: update API reference
test: add integration tests for circuit breaker
perf: optimize middleware caching
```

This enables automatic version bumping:
- `feat:` → minor version bump
- `fix:` → patch version bump
- `BREAKING CHANGE:` → major version bump

### Running Locally

```bash
# Start gateway
npm start

# Development mode (auto-reload)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Fix lint issues
npm run lint:fix

# Check version/status
npm run status
```

### Adding a Plugin

1. Create `src/plugins/builtins/your-plugin.js`:
   ```js
   export default {
     name: 'your-plugin',
     version: '1.0.0',
     description: 'What it does',
     defaultOptions: { /* defaults */ },

     // Pre-proxy hook (before upstream call)
     handler: (req, res, next) => { next(); },

     // Post-proxy hook (after upstream response)
     postHandler: (req, res, next) => { next(); },

     // Error hook (on proxy/plugin error)
     onError: (err, req, res, next) => { next(err); },
   };
   ```

2. Add config to `plugins.json`:
   ```json
   {
     "your-plugin": { "enabled": false }
   }
   ```

3. Add tests in `test/your-plugin.test.js`

4. Update `PLUGINS.md` documentation

### Adding a Route Config

In `plugins.json`, add per-route configuration:

```json
{
  "routes": {
    "/your-api": {
      "plugins": {
        "jwt-auth": { "enabled": true },
        "rate-limiter": { "enabled": true, "maxRequests": 50 }
      }
    }
  }
}
```

## Testing

- All new features must include tests
- Tests use [Vitest](https://vitest.dev/)
- Run `npm test` before submitting PR
- Aim for >80% coverage on new code

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run test/your-plugin.test.js
```

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure lint passes: `npm run lint`
3. Update ROADMAP.md if you completed a task
4. Update CHANGELOG.md (or use `npm run changelog`)
5. Submit PR with description of changes
6. Reference the task ID in PR title: `feat(T13-01a): Add Redis rate limiter`

## Code Style

- ES Modules (`import/export`)
- 2-space indentation
- Descriptive variable names
- Comment complex logic only

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce
- Include expected vs actual behavior
- Include Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
