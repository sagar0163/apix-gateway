# Architecture Document: APIX Gateway

## 1. System Overview

APIX Gateway is a modular API Gateway built on Express.js with a plugin-based architecture. It processes incoming requests through a chain of plugins before proxying to upstream services.

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Requests                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express Server                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Plugin Chain (Middleware)               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │  Auth   │ │ Rate   │ │Transform│ │ Metrics │   │   │
│  │  │ Plugins │ │ Limiter │ │ Plugins │ │         │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Plugin System                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Plugin Manager (src/plugins/index.js)              │   │
│  │  • Plugin loading & registration                     │   │
│  │  • Lifecycle management                              │   │
│  │  • Configuration                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Upstream │    │ Upstream │    │ Upstream │
    │ Service 1│    │ Service 2│    │ Service 3│
    └──────────┘    └──────────┘    └──────────┘
```

## 3. Core Components

### Plugin System
- **Plugin Manager:** Loads and manages all plugins
- **Built-in Plugins:** 35+ included plugins
- **Plugin Interface:** Standard lifecycle hooks

### Middleware Chain
```
Request → Auth → Rate Limit → Transform → Proxy → Metrics → Response
```

### Admin Dashboard
- **Frontend:** Static HTML/CSS/JS
- **API:** Express routes for management
- **Auth:** JWT-based admin authentication

## 4. File Structure

```
apix-gateway/
├── src/
│   ├── index.js           # Entry point
│   ├── plugins/           # Plugin system
│   │   ├── index.js       # Plugin manager
│   │   └── builtins/     # 35+ plugins
│   ├── middleware/        # Express middleware
│   ├── routes/           # API routes
│   │   ├── admin.js      # Admin API
│   │   └── proxy.js      # Proxy handler
│   └── utils/            # Utilities
├── ui/                   # Admin dashboard
├── plugins.json          # Plugin configuration
├── package.json
└── specs/                # This documentation
```

---

*Document Version: 1.0*  
*Created: 2026-03-17*
