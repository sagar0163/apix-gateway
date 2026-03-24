import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.enabledPlugins = new Set();
    this.pluginInstances = new Map();
    this._middlewareCache = null;
    this._middlewareCacheTime = 0;
    this._cacheTTL = 1000; // Cache middleware for 1 second
  }

  // Load built-in plugins
  async loadBuiltInPlugins() {
    const builtInPlugins = [
      'rate-limiter',
      'sliding-window-rate-limiter',
      'jwt-auth',
      'api-key',
      'request-transformer',
      'response-transformer',
      'ip-whitelist',
      'cors',
      'compression',
      'metrics',
      'circuit-breaker'
    ];

    for (const pluginName of builtInPlugins) {
      try {
        const plugin = await import(`./builtins/${pluginName}.js`);
        this.register(pluginName, plugin.default);
        logger.info(`Loaded built-in plugin: ${pluginName}`);
      } catch (err) {
        logger.warn(`Failed to load plugin ${pluginName}: ${err.message}`);
      }
    }
  }

  // Load custom plugins from plugins/ directory
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

  // Register a plugin (thread-safe)
  register(name, plugin) {
    if (!plugin || !plugin.name) {
      throw new Error('Plugin must have a name and handler');
    }
    
    this.plugins.set(name, {
      ...plugin,
      name,
      enabled: false
    });
    
    // Invalidate middleware cache on registration change
    this._invalidateCache();
    
    logger.info(`Registered plugin: ${name}`);
  }

  // Enable a plugin (thread-safe with mutex pattern)
  enable(name, options = {}) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    // Create instance with options
    const instance = {
      ...plugin,
      enabled: true,
      options: { ...plugin.defaultOptions, ...options }
    };

    // Atomic update: set instance first, then add to enabled set
    this.pluginInstances.set(name, instance);
    this.enabledPlugins.add(name);
    
    // Invalidate cache after state change
    this._invalidateCache();
    
    logger.info(`Enabled plugin: ${name}`);
    return instance;
  }

  // Disable a plugin (thread-safe)
  disable(name) {
    this.pluginInstances.delete(name);
    this.enabledPlugins.delete(name);
    
    // Invalidate cache after state change
    this._invalidateCache();
    
    logger.info(`Disabled plugin: ${name}`);
  }

  // Invalidate middleware cache
  _invalidateCache() {
    this._middlewareCache = null;
    this._middlewareCacheTime = 0;
  }

  // Get enabled plugins (returns snapshot for thread safety)
  getEnabledPlugins() {
    // Return a snapshot to prevent concurrent modification issues
    const enabled = [];
    for (const name of this.enabledPlugins) {
      const plugin = this.pluginInstances.get(name);
      if (plugin) {
        enabled.push({
          name: plugin.name,
          version: plugin.version,
          options: plugin.options
        });
      }
    }
    return enabled;
  }

  // Get plugin by name
  getPlugin(name) {
    return this.pluginInstances.get(name);
  }

  // List all plugins
  list() {
    return Array.from(this.plugins.keys());
  }

  // Create middleware from enabled plugins (with caching for performance)
  createMiddleware() {
    return async (req, res, next) => {
      const now = Date.now();
      
      // Check cache validity
      let pluginChain;
      if (this._middlewareCache && (now - this._middlewareCacheTime) < this._cacheTTL) {
        pluginChain = this._middlewareCache;
      } else {
        // Create snapshot of enabled plugins for this request
        pluginChain = this.getEnabledPlugins();
        
        // Cache for hot path optimization
        this._middlewareCache = pluginChain;
        this._middlewareCacheTime = now;
      }
      
      const runPlugin = async (index) => {
        if (index >= pluginChain.length) {
          return next();
        }

        const pluginName = pluginChain[index].name;
        const plugin = this.pluginInstances.get(pluginName);

        if (!plugin || !plugin.handler) {
          return runPlugin(index + 1);
        }

        try {
          const result = await plugin.handler(req, res, () => runPlugin(index + 1));
          
          // If plugin returns false, stop the chain
          if (result === false) {
            return; // Response already sent
          }
          
          // If plugin returns a value, use it as response
          if (result !== undefined) {
            return res.json(result);
          }
        } catch (err) {
          logger.error(`Plugin ${pluginName} error:`, err);
          
          if (plugin.onError) {
            return plugin.onError(err, req, res, () => runPlugin(index + 1));
          }
          
          return res.status(500).json({ 
            error: 'Plugin error', 
            plugin: pluginName,
            message: err.message 
          });
        }
      };

      await runPlugin(0);
    };
  }
}

// Singleton instance
export const pluginManager = new PluginManager();
export default pluginManager;
