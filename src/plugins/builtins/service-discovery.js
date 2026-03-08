// Service Discovery Plugin
import axios from 'axios';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  provider: 'static', // 'static', 'consul', 'etcd', 'kubernetes'
  services: {}, // { users: 'http://consul:8500' }
  refreshInterval: 30000,
  fallbackTargets: {}
};

export default {
  name: 'service-discovery',
  version: '1.0.0',
  description: 'Dynamic service discovery',
  defaultOptions: DEFAULT_OPTIONS,

  // Service registry
  registry: new Map(),

  // Initialize
  async init(options) {
    switch (options.provider) {
      case 'consul':
        await this.initConsul(options);
        break;
      case 'kubernetes':
        await this.initKubernetes(options);
        break;
      default:
        // Static - just use fallback targets
        break;
    }

    // Start refresh interval
    if (options.refreshInterval > 0) {
      setInterval(() => this.refresh(options), options.refreshInterval);
    }
  },

  // Consul integration
  async initConsul(options) {
    const consulUrl = options.services?.consul;
    if (!consulUrl) return;

    try {
      const response = await axios.get(`${consulUrl}/v1/health/service/${serviceName}`);
      // Parse and update registry
    } catch (err) {
      logger.error('Consul init failed:', err.message);
    }
  },

  // Kubernetes integration
  async initKubernetes(options) {
    // Would use Kubernetes API
    logger.info('Kubernetes service discovery initialized');
  },

  // Refresh service endpoints
  async refresh(options) {
    logger.debug('Refreshing service discovery...');
    // In production, poll Consul/etcd/Kubernetes
  },

  // Get service endpoint
  getService(name) {
    return this.registry.get(name) || null;
  },

  // Register service
  registerService(name, endpoints) {
    this.registry.set(name, {
      endpoints,
      updatedAt: Date.now()
    });
  },

  // Get healthy endpoint (simple round-robin)
  getHealthyEndpoint(name) {
    const service = this.registry.get(name);
    if (!service || !service.endpoints.length) return null;
    
    const idx = Math.floor(Math.random() * service.endpoints.length);
    return service.endpoints[idx];
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['service-discovery'] || DEFAULT_OPTIONS;
    
    // Extract service name from path (/service-name/...)
    const parts = req.path.split('/').filter(Boolean);
    const serviceName = parts[0];

    if (options.services[serviceName]) {
      const endpoint = this.getHealthyEndpoint(serviceName) || options.fallbackTargets[serviceName];
      
      if (endpoint) {
        req._serviceDiscovery = {
          service: serviceName,
          endpoint,
          resolved: true
        };
        
        res.set('X-Service-Discovery', serviceName);
      }
    }

    next();
  }
};
