# Issue 15: Declarative YAML Configuration (GitOps Support)

- [x] Implement `loadYamlConfig()` in `src/utils/config.js` to parse `apix.yaml` using `js-yaml` and merge it with current config.
- [x] Implement hot-reloading using `fs.watch` in `src/utils/config.js` or `src/index.js` to re-apply configuration when `apix.yaml` changes.
- [x] Add `validate` command to `src/cli.js` to validate YAML syntax of `apix.yaml`. (Already existed!)
- [ ] Add unit tests for YAML config loading, hot-reloading, and CLI validate command.
