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
  }

  // Load built-in plugins
  async loadBuiltInPlugins() {
    const builtInPlugins = [
      'rate-limiter',
      'jwt-auth',
      'api-key',
      'request-transformer',
      'response-transformer',
      'ip-whitelist',
      ' cors',
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
        logger.error(`Failed to load plugin ${file}:`, err);
      }
    }
  }

  // Register a plugin
  register(name, plugin) {
    if (!plugin || !plugin.name) {
      throw new Error('Plugin must have a name and handler');
    }
    
    this.plugins.set(name, {
      ...plugin,
      name,
      enabled: false
    });
    
    logger.info(`Registered plugin: ${name}`);
  }

  // Enable a plugin
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
    
    logger.info(`Enabled plugin: ${name}`);
    return instance;
  }

  // Disable a plugin
  disable(name) {
    this.pluginInstances.delete(name);
    this.enabledPlugins.delete(name);
    logger.info(`Disabled plugin: ${name}`);
  }

  // Get enabled plugins
  getEnabledPlugins() {
    return Array.from(this.enabledPlugins).map(name => {
      const plugin = this.pluginInstances.get(name);
      return {
        name: plugin.name,
        version: plugin.version,
        options: plugin.options
      };
    });
  }

  // Get plugin by name
  getPlugin(name) {
    return this.pluginInstances.get(name);
  }

  // List all plugins
  list() {
    return Array.from(this.plugins.keys());
  }

  // Create middleware from enabled plugins
  createMiddleware() {
    return async (req, res, next) => {
      const pluginChain = Array.from(this.enabledPlugins);
      
      const runPlugin = async (index) => {
        if (index >= pluginChain.length) {
          return next();
        }

        const pluginName = pluginChain[index];
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
