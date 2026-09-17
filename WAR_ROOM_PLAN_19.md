# WAR ROOM PLAN — Issue #19: Prometheus Integration & pre-built Grafana Dashboard

Prior attempts (commits 75f3aad..f673a21) already delivered:
- `/metrics` endpoint in Prometheus + JSON format
- Plugin execution duration tracking in `src/plugins/index.js`
- Grafana dashboard at `dashboards/apix-dashboard.json`
- Unit tests in `test/metrics.test.js` (passing)
- README observability docs

Remaining verification/hardening work:

- [x] Fix middleware status-code capture timing (status/labels must be read on response `finish`, not at request time — currently everything is recorded as 200)
- [x] Fix Prometheus exposition format (emit `# TYPE ... counter` for `*_total`, emit HELP/TYPE once per metric family, not repeated per label set)
- [x] Harden metrics tests to cover counter typing and status labels
- [x] Confirm `npm test` (metrics suite) + lint on touched files pass
- [ ] Delete WAR_ROOM_PLAN_19.md and make final commit; push branch