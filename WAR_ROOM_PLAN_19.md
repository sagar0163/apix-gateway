# WAR ROOM PLAN — Issue #19: Prometheus Integration + Grafana Dashboard

## State from prior attempts (already committed on `war-room-issue-19`)
- [x] `src/middleware/prometheus.js` — metrics store + Prometheus exposition (counters/gauges, labeled by method/status/plugin)
- [x] `src/index.js` — wired `prometheusMetrics()` middleware + `/metrics` endpoint (+ `?format=json`)
- [x] `src/plugins/index.js` — `trackPluginDuration` timing around plugin execution for plugin-overhead metric
- [x] `dashboards/apix-dashboard.json` — Grafana dashboard (traffic, latency, plugin overhead, errors, process health)
- [x] `test/metrics.test.js` — endpoint format + status-aware counters tests (all 4 pass)
- [x] README "Observability" section (metrics table + dashboard import)
- [x] Lint clean on `src` (prior commits)

## Remaining subtasks
- [x] Replace hardcoded `apix_event_loop_lag_seconds 0` with real event-loop-lag sampling (unref'd timer so it doesn't hold the process open)
- [x] Add `prometheus.yml` scrape config for the gateway `/metrics` endpoint
- [x] Add Grafana provisioning: datasource (`grafana/provisioning/datasources`) + dashboard provider + dashboard json
- [x] Extend `docker-compose.yml` with `prometheus` + `grafana` services for one-command observability stack
- [x] Document the docker-compose observability stack + scrape config in README
- [ ] Run `npm test` (metrics tests) + `npm run lint`; verify pre-existing unrelated failures unchanged
- [ ] Remove plan file, final commit referencing #19, push branch