# APIX Gateway — CEO Vision (for gstack Office Hours)

## The One-Liner
A production-ready, self-hosted API Gateway (Kong/Tyk/Apigee alternative) built in pure Node.js with a plugin architecture — **but with a v2.0 AI/LLM Gateway differentiator** that no major player has natively solved yet.

## Current State
- v1.3.0 in development (distributed infra: Redis rate limiting, declarative YAML, OpenTelemetry, service discovery)
- 35+ plugins working (auth, security, traffic, transform, monitoring, advanced)
- Admin dashboard with real-time stats, plugin toggles, API key mgmt
- Docker + CI/CD ready
- Tests passing (30/34, 4 skipped)

## The Big Bet (v2.0)
**AI/LLM Gateway** — token counting, cost tracking, prompt injection detection, model fallback, response caching, streaming proxy. Kong added this recently but it's bolted on; we build it *native* from v1.3 primitives.

## Why Now
- Every company adding LLMs needs: cost control, security, observability
- Existing gateways treat LLMs as generic HTTP — miss token/cost semantics
- Self-hosted + open source wins in regulated/enterprise
- Node.js ecosystem = huge contributor pool vs Lua (Kong) or Go (Tyk)

## Target Users
1. **Platform teams** at mid-size companies (50-500 eng) adopting LLMs
2. **Enterprises** needing self-hosted, auditable, compliant gateway
3. **AI startups** needing LLM-specific features without vendor lock-in

## Business Model (Eventual)
- Open core (MIT) — gateway + plugins free
- Enterprise: clustering/HA, RBAC, audit logs, dedicated support
- Cloud managed: hosted control plane (later)

## What I Need from Office Hours
- Stress-test the AI Gateway differentiator: is it real or feature creep?
- Validate the sequencing: v1.3 distributed infra → v1.4 security → v1.5 observability → v2.0 AI
- Identify the "desperate specificity" — who has this problem *today* and will pay?
- Check if we're too late (Kong just launched AI Gateway)
