# WAR ROOM PLAN — Issue #19: Prometheus Integration and pre-built Grafana Dashboard

## Acceptance Criteria
- Expose a `/metrics` endpoint natively in Prometheus format.
- Provide a `.json` Grafana dashboard template in a `/dashboards` directory visualizing traffic, latency, and plugin overhead.

## Subtasks

- [x] Add `/metrics` endpoint in `src/index.js` (Prometheus text + `?format=json`)
- [x] Add `apix_plugin_execution_duration_seconds` / `apix_plugin_duration_seconds{plugin}` metrics in `src/middleware/prometheus.js`
- [x] Track plugin execution duration in plugin runner `src/plugins/index.js`
- [x] Add Grafana dashboard template at `dashboards/apix-dashboard.json` (traffic, latency, plugin overhead)
- [x] Add tests in `test/metrics.test.js` for `/metrics` and `/metrics?format=json`
- [x] Fix ESLint errors (trailing spaces) in touched files
- [x] Document `/metrics` endpoint + Grafana import in `README.md`
- [ ] Run full test suite + lint; verify no new failures vs. main
- [ ] Final commit, cleanup plan file, push branch