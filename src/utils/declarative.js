/**
 * Declarative Configuration Loader
 * Supports YAML and JSON config files for APIX Gateway
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from './logger.js';

/**
 * Load config from YAML or JSON file
 */
export function loadDeclarativeConfig(configPath = './apix.yaml') {
  if (!fs.existsSync(configPath)) {
    // Try .json extension
    const jsonPath = configPath.replace(/\.ya?ml$/, '.json');
    if (fs.existsSync(jsonPath)) {
      configPath = jsonPath;
    } else {
      return null;
    }
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const ext = path.extname(configPath).toLowerCase();

  let config;
  if (ext === '.json') {
    config = JSON.parse(content);
  } else {
    config = yaml.load(content);
  }

  return config;
}

/**
 * Validate declarative config schema
 */
export function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }

  // Validate version
  if (config.version && typeof config.version !== 'string') {
    errors.push('version must be a string');
  }

  // Validate server
  if (config.server) {
    if (config.server.port && typeof config.server.port !== 'number') {
      errors.push('server.port must be a number');
    }
    if (config.server.host && typeof config.server.host !== 'string') {
      errors.push('server.host must be a string');
    }
  }

  // Validate upstreams
  if (config.upstreams) {
    if (typeof config.upstreams !== 'object') {
      errors.push('upstreams must be an object');
    } else {
      for (const [name, upstream] of Object.entries(config.upstreams)) {
        if (!upstream.url) {
          errors.push(`upstreams.${name} requires a url`);
        }
        if (upstream.targets && !Array.isArray(upstream.targets)) {
          errors.push(`upstreams.${name}.targets must be an array`);
        }
      }
    }
  }

  // Validate routes
  if (config.routes) {
    if (!Array.isArray(config.routes)) {
      errors.push('routes must be an array');
    } else {
      for (let i = 0; i < config.routes.length; i++) {
        const route = config.routes[i];
        if (!route.path) {
          errors.push(`routes[${i}] requires a path`);
        }
        if (!route.upstream && !route.target) {
          errors.push(`routes[${i}] requires an upstream or target`);
        }
        if (route.plugins && typeof route.plugins !== 'object') {
          errors.push(`routes[${i}].plugins must be an object`);
        }
      }
    }
  }

  // Validate plugins
  if (config.plugins) {
    if (typeof config.plugins !== 'object') {
      errors.push('plugins must be an object');
    } else {
      for (const [name, plugin] of Object.entries(config.plugins)) {
        if (typeof plugin !== 'object') {
          errors.push(`plugins.${name} must be an object`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Convert declarative config to internal format
 */
export function configToInternal(config) {
  const result = {
    plugins: {},
    routes: {},
    apis: {}
  };

  // Convert server config
  if (config.server) {
    result.port = config.server.port || 3000;
  }

  // Convert routes to apis and route configs
  if (config.routes && Array.isArray(config.routes)) {
    for (const route of config.routes) {
      const prefix = route.path;
      const target = route.target || route.upstream;

      // Resolve upstream reference
      if (config.upstreams && config.upstreams[target]) {
        const upstream = config.upstreams[target];
        result.apis[prefix] = upstream.url || upstream.targets?.[0] || target;
      } else {
        result.apis[prefix] = target;
      }

      // Convert route plugins
      if (route.plugins) {
        result.routes[prefix] = { plugins: route.plugins };
      }
    }
  }

  // Merge global plugins
  if (config.plugins) {
    for (const [name, plugin] of Object.entries(config.plugins)) {
      result.plugins[name] = typeof plugin === 'object'
        ? { enabled: true, ...plugin }
        : { enabled: plugin };
    }
  }

  return result;
}

/**
 * Export current running config as YAML
 */
export function exportConfig(apis, pluginManager) {
  const config = {
    version: '1.0',
    server: {
      port: 3000,
      host: '0.0.0.0'
    },
    upstreams: {},
    routes: [],
    plugins: {}
  };

  // Export upstreams from apis
  for (const [prefix, target] of Object.entries(apis || {})) {
    const name = prefix.replace(/^\//, '').replace(/\//g, '-') || 'default';
    config.upstreams[name] = { url: target };
    config.routes.push({
      path: prefix,
      upstream: name
    });
  }

  // Export plugins
  const enabledPlugins = pluginManager.getEnabledPlugins();
  for (const plugin of enabledPlugins) {
    config.plugins[plugin.name] = plugin.options || { enabled: true };
  }

  // Export route configs
  const routeConfigs = pluginManager.getAllRouteConfigs();
  for (const [prefix, plugins] of Object.entries(routeConfigs)) {
    const route = config.routes.find(r => r.path === prefix);
    if (route) {
      route.plugins = plugins;
    }
  }

  return yaml.dump(config, { indent: 2, lineWidth: 120 });
}

/**
 * Apply declarative config to the gateway
 */
export function applyConfig(config, pluginManager, existingApis = {}) {
  const internal = configToInternal(config);

  // Apply plugin configs
  for (const [name, options] of Object.entries(internal.plugins)) {
    if (options.enabled !== false) {
      try {
        pluginManager.enable(name, options);
      } catch (err) {
        logger.warn(`Failed to enable plugin ${name}: ${err.message}`);
      }
    }
  }

  // Apply route configs
  for (const [prefix, routeConfig] of Object.entries(internal.routes)) {
    if (routeConfig.plugins) {
      pluginManager.setRouteConfig(prefix, routeConfig.plugins);
    }
  }

  return internal;
}
