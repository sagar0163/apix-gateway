import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Plugin Lifecycle Phases:
 *
 *   Request
 *     → [global pre-proxy]   — runs on every request (rate-limit, cors, auth)
 *     → [route pre-proxy]    — runs only on matched route (route-specific auth, validation)
 *     → Proxy                — forward to upstream
 *     → [route post-proxy]   — runs after proxy (route-specific transform, cache)
 *     → [global post-proxy]  — runs on every response (metrics, logging)
 *     → Response
 *
 *   onError:
 *     → [global on-error]    — runs when any plugin or proxy fails
 *     → [route on-error]     — runs for route-specific error handling
 *
 * Plugin phases:
 *   - handler (preProxy) — default, runs before proxy
 *   - postHandler       — runs after proxy response
 *   - onError           — runs on error
 */

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.enabledPlugins = new Set();
    this.pluginInstances = new Map();
    this._middlewareCache = null;
    this._middlewareCacheTime = 0;
    this._cacheTTL = 1000;

    // Route-specific plugin configs
    // Format: { '/api/users': { 'jwt-auth': { enabled: true, maxRequests: 50 } } }
    this.routeConfigs = new Map();
  }

  // =======================
  // Plugin Registration
  // =======================

  async loadBuiltInPlugins() {
    const builtInDir = path.resolve(__dirname, 'builtins');
    const files = fs.readdirSync(builtInDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
      try {
        const pluginName = path.basename(file, '.js');
        const plugin = await import(`./builtins/${file}`);
        this.register(pluginName, plugin.default);
        logger.info(`Loaded built-in plugin: ${pluginName}`);
      } catch (err) {
        logger.warn(`Failed to load built-in plugin ${file}: ${err.message}`);
      }
    }
  }

  async loadCustomPlugins(pluginsDir = './plugins') {
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      logger.info(`Created plugins directory: ${pluginsDir}`);
      return;
    }

    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
      try {
        const pluginPath = path.resolve(pluginsDir, file);
        const plugin = await import(`file://${pluginPath}`);
        const name = path.basename(file, '.js');
        this.register(name, plugin.default);
        logger.info(`Loaded custom plugin: ${name}`);
      } catch (err) {
        logger.error(`Failed to load plugin ${file}: ${err}`);
      }
    }
  }

  register(name, plugin) {
    if (!plugin || !plugin.name) {
      throw new Error('Plugin must have a name and handler');
    }

    this.plugins.set(name, {
      ...plugin,
      name,
      enabled: false
    });

    this._invalidateCache();
    logger.info(`Registered plugin: ${name}`);
  }

  // =======================
  // Enable / Disable
  // =======================

  enable(name, options = {}) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    const instance = {
      ...plugin,
      enabled: true,
      options: { ...plugin.defaultOptions, ...options }
    };

    this.pluginInstances.set(name, instance);
    this.enabledPlugins.add(name);
    this._invalidateCache();

    logger.info(`Enabled plugin: ${name}`);
    return instance;
  }

  disable(name) {
    this.pluginInstances.delete(name);
    this.enabledPlugins.delete(name);
    this._invalidateCache();
    logger.info(`Disabled plugin: ${name}`);
  }

  // =======================
  // Route-Specific Config
  // =======================

  /**
   * Configure plugins for a specific route prefix.
   *
   * Example:
   *   pluginManager.setRouteConfig('/api/users', {
   *     'jwt-auth': { enabled: true },
   *     'rate-limiter': { enabled: true, maxRequests: 50 },
   *     'cache': { enabled: false }
   *   });
   */
  setRouteConfig(routePrefix, pluginConfigs) {
    this.routeConfigs.set(routePrefix, pluginConfigs);
    this._invalidateCache();
    logger.info(`Set route config for ${routePrefix}: ${Object.keys(pluginConfigs).join(', ')}`);
  }

  /**
   * Get route config for a path
   */
  getRouteConfig(reqPath) {
    for (const [prefix, config] of this.routeConfigs) {
      if (reqPath.startsWith(prefix)) {
        return { prefix, config };
      }
    }
    return null;
  }

  /**
   * Get all route configs
   */
  getAllRouteConfigs() {
    const result = {};
    for (const [prefix, config] of this.routeConfigs) {
      result[prefix] = config;
    }
    return result;
  }

  // =======================
  // Query Methods
  // =======================

  _invalidateCache() {
    this._middlewareCache = null;
    this._middlewareCacheTime = 0;
  }

  getEnabledPlugins() {
    const enabled = [];
    for (const name of this.enabledPlugins) {
      const plugin = this.pluginInstances.get(name);
      if (plugin) {
        enabled.push({
          name: plugin.name,
          version: plugin.version,
          options: plugin.options,
          phase: plugin.phase || 'preProxy',
          hasPostHandler: !!plugin.postHandler,
          hasOnError: !!plugin.onError
        });
      }
    }
    return enabled;
  }

  getPlugin(name) {
    return this.pluginInstances.get(name);
  }

  list() {
    return Array.from(this.plugins.keys());
  }

  // =======================
  // Core Execution Engine
  // =======================

  /**
   * Get plugins to run for a given phase and request path.
   * Returns both global plugins and route-specific overrides.
   */
  _getPluginsForPhase(phase, reqPath) {
    const result = [];
    const routeOverride = this.getRouteConfig(reqPath);
    const routePlugins = routeOverride?.config || {};

    for (const name of this.enabledPlugins) {
      const plugin = this.pluginInstances.get(name);
      if (!plugin) continue;

      // Check route-specific override
      const routeConfig = routePlugins[name];

      // If route explicitly disables this plugin, skip
      if (routeConfig && routeConfig.enabled === false) continue;

      // Check if plugin has handler for this phase
      let handler = null;
      if (phase === 'preProxy' && plugin.handler) handler = plugin.handler;
      if (phase === 'postProxy' && plugin.postHandler) handler = plugin.postHandler;
      if (phase === 'onError' && plugin.onError) handler = plugin.onError;

      if (!handler) continue;

      // Merge options: global defaults → global config → route config
      const options = routeConfig
        ? { ...plugin.options, ...routeConfig }
        : plugin.options;

      result.push({
        name,
        handler,
        options,
        scope: routeConfig ? 'route' : 'global'
      });
    }

    // Add route-only plugins (enabled on route but globally disabled)
    for (const [name, routeConfig] of Object.entries(routePlugins)) {
      if (routeConfig.enabled !== true) continue;
      if (this.enabledPlugins.has(name)) continue; // Already added above

      const plugin = this.plugins.get(name);
      if (!plugin) continue;

      let handler = null;
      if (phase === 'preProxy' && plugin.handler) handler = plugin.handler;
      if (phase === 'postProxy' && plugin.postHandler) handler = plugin.postHandler;
      if (phase === 'onError' && plugin.onError) handler = plugin.onError;

      if (!handler) continue;

      const options = { ...plugin.defaultOptions, ...routeConfig };
      result.push({
        name,
        handler,
        options,
        scope: 'route'
      });
    }

    // Sort: global first, then route-specific
    result.sort((a, b) => {
      if (a.scope === 'global' && b.scope !== 'global') return -1;
      if (a.scope !== 'global' && b.scope === 'global') return 1;
      return 0;
    });

    return result;
  }

  /**
   * Execute plugins for a specific phase.
   */
  async _executePhase(phase, req, res, next, error = null) {
    const plugins = this._getPluginsForPhase(phase, req.path);

    const runPlugin = async (index) => {
      if (index >= plugins.length) {
        return next();
      }

      const { name, handler, options } = plugins[index];

      try {
        req._pluginOptions = req._pluginOptions || {};
        req._pluginOptions[name] = options;

        if (phase === 'onError') {
          await handler(error, req, res, () => runPlugin(index + 1));
        } else {
          await handler(req, res, () => runPlugin(index + 1));
        }
      } catch (err) {
        logger.error(`Plugin ${name} error in ${phase}:`, err);

        if (!res.headersSent) {
          return res.status(500).json({
            error: 'Plugin error',
            plugin: name,
            phase,
            message: err.message
          });
        }
      }
    };

    await runPlugin(0);
  }

  // =======================
  // Middleware Factories
  // =======================

  /**
   * Global pre-proxy middleware. Runs on every request.
   */
  createMiddleware() {
    return async (req, res, next) => {
      await this._executePhase('preProxy', req, res, next);
    };
  }

  /**
   * Post-proxy middleware. Runs after proxy response.
   */
  createPostMiddleware() {
    return async (req, res, next) => {
      await this._executePhase('postProxy', req, res, next);
    };
  }

  /**
   * Error middleware. Runs when any error occurs.
   */
  createErrorMiddleware() {
    return async (err, req, res, next) => {
      await this._executePhase('onError', req, res, next, err);
      if (!res.headersSent) {
        next(err);
      }
    };
  }

  // =======================
  // Route-Level Execution
  // =======================

  /**
   * Run pre-proxy phase for a specific request.
   */
  async runPreProxy(req, res) {
    return new Promise((resolve, reject) => {
      this._executePhase('preProxy', req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Run post-proxy phase for a specific request.
   */
  async runPostProxy(req, res) {
    return new Promise((resolve, reject) => {
      this._executePhase('postProxy', req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Run error phase for a specific request.
   */
  async runOnError(error, req, res) {
    return new Promise((resolve) => {
      this._executePhase('onError', req, res, () => resolve(), error);
    });
  }
}

// Singleton instance
export const pluginManager = new PluginManager();
export default pluginManager;
