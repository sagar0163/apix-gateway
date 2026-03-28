import express from 'express';
import { pluginManager } from '../plugins/index.js';
import { loadConfig } from '../utils/config.js';

const router = express.Router();
const config = loadConfig();

// Plugin categories for OpenAPI grouping
const PLUGIN_CATEGORIES = {
  'Authentication': ['jwt-auth', 'api-key', 'basic-auth', 'hmac-auth', 'oauth2', 'keycloak'],
  'Security': ['cors', 'ip-whitelist', 'bot-detection', 'request-size', 'request-validator', 'graphql-protection'],
  'Traffic Control': ['rate-limiter', 'quota', 'timeout', 'retry', 'circuit-breaker', 'load-balancer', 'sliding-window-rate-limiter'],
  'Transformations': ['request-transformer', 'response-transformer', 'header-enrichment', 'url-rewrite', 'pagination'],
  'Performance': ['cache', 'compression'],
  'Monitoring': ['metrics', 'request-log', 'traffic-stats', 'distributed-trace'],
  'Advanced': ['grpc-transcoder', 'websocket', 'service-discovery', 'canary-release', 'ab-test', 'mock-response', 'request-mirror', 'dynamic-routing', 'request-id']
};

function generateOpenAPISpec() {
  const enabledPlugins = pluginManager.getEnabledPlugins();
  const allPluginNames = pluginManager.list();

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'APIX Gateway',
      description: 'A modern, production-ready API Gateway built with Node.js — featuring rate limiting, authentication, caching, analytics, and a beautiful admin dashboard.',
      version: '1.2.0',
      contact: {
        name: 'Sagar Jadhav',
        url: 'https://github.com/sagar0163/apix-gateway',
        email: 'sagar0163@users.noreply.github.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: `http://localhost:${config.port || 3000}`,
        description: 'Local development server'
      }
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Admin - Auth', description: 'Admin authentication' },
      { name: 'Admin - Stats', description: 'Gateway statistics and metrics' },
      { name: 'Admin - Plugins', description: 'Plugin management' },
      { name: 'Admin - API Keys', description: 'API key management' },
      { name: 'Admin - Circuit Breakers', description: 'Circuit breaker management' },
      { name: 'Admin - Security', description: 'Security management' },
      { name: 'Admin - Cache', description: 'Cache management' },
      { name: 'Proxy', description: 'API proxy routes' },
      { name: 'Documentation', description: 'API documentation endpoints' }
    ],
    paths: {
      // Health endpoints
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Basic health check',
          description: 'Returns the current health status of the gateway including enabled plugins.',
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Gateway is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' }
                }
              }
            }
          }
        }
      },
      '/health/detailed': {
        get: {
          tags: ['Health'],
          summary: 'Detailed health check',
          description: 'Returns detailed health information including memory usage, CPU usage, and plugin status.',
          operationId: 'getDetailedHealth',
          responses: {
            '200': {
              description: 'Detailed health information',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DetailedHealthResponse' }
                }
              }
            }
          }
        }
      },
      // Admin Auth
      '/admin/login': {
        post: {
          tags: ['Admin - Auth'],
          summary: 'Admin login',
          description: 'Authenticate with username and password to receive a JWT token.',
          operationId: 'adminLogin',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'password'],
                  properties: {
                    username: { type: 'string', example: 'admin' },
                    password: { type: 'string', example: '********' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string', description: 'JWT token' },
                      role: { type: 'string', example: 'admin' },
                      expiresIn: { type: 'string', example: '24h' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' }
          }
        }
      },
      // Admin Stats
      '/admin/stats': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'Gateway statistics',
          description: 'Returns uptime, memory, CPU usage, and plugin counts.',
          operationId: 'getStats',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Gateway statistics',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StatsResponse' }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/health': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'Detailed admin health',
          description: 'Returns detailed health info for admin dashboard.',
          operationId: 'getAdminHealth',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Admin health information',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DetailedHealthResponse' }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/metrics': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'Request metrics',
          description: 'Returns request-level metrics from the metrics plugin.',
          operationId: 'getMetrics',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Metrics data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      requests: { type: 'object' },
                      latency: { type: 'object' },
                      errors: { type: 'object' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/metrics/json': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'JSON metrics',
          description: 'Returns metrics in JSON format.',
          operationId: 'getMetricsJSON',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'JSON metrics',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MetricsResponse' }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/metrics/prometheus': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'Prometheus metrics',
          description: 'Returns metrics in Prometheus exposition format for scraping. No authentication required.',
          operationId: 'getPrometheusMetrics',
          responses: {
            '200': {
              description: 'Prometheus metrics text',
              content: {
                'text/plain': {
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/admin/metrics/reset': {
        post: {
          tags: ['Admin - Stats'],
          summary: 'Reset metrics',
          description: 'Resets all collected metrics. Requires admin role.',
          operationId: 'resetMetrics',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Metrics reset',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/admin/websocket': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'WebSocket connection stats',
          description: 'Returns current WebSocket connection statistics.',
          operationId: 'getWebSocketStats',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'WebSocket stats',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      connections: { type: 'number' },
                      rooms: { type: 'number' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/traffic': {
        get: {
          tags: ['Admin - Stats'],
          summary: 'Traffic statistics',
          description: 'Returns traffic statistics from the traffic-stats plugin.',
          operationId: 'getTrafficStats',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Traffic statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      byRoute: { type: 'object' },
                      byMethod: { type: 'object' },
                      byStatus: { type: 'object' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      // Plugins
      '/admin/plugins': {
        get: {
          tags: ['Admin - Plugins'],
          summary: 'List all plugins',
          description: 'Returns available and enabled plugins with their status.',
          operationId: 'listPlugins',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Plugin list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PluginListResponse' }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/plugins/{name}': {
        get: {
          tags: ['Admin - Plugins'],
          summary: 'Get plugin details',
          description: 'Returns details of a specific plugin by name.',
          operationId: 'getPlugin',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Plugin name'
            }
          ],
          responses: {
            '200': {
              description: 'Plugin details',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Plugin' }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/admin/plugins/{name}/enable': {
        post: {
          tags: ['Admin - Plugins'],
          summary: 'Enable a plugin',
          description: 'Enables a plugin with optional configuration. Requires admin role.',
          operationId: 'enablePlugin',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Plugin name'
            }
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    options: {
                      type: 'object',
                      description: 'Plugin configuration options',
                      additionalProperties: true
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Plugin enabled',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/admin/plugins/{name}/disable': {
        post: {
          tags: ['Admin - Plugins'],
          summary: 'Disable a plugin',
          description: 'Disables an active plugin. Requires admin role.',
          operationId: 'disablePlugin',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Plugin name'
            }
          ],
          responses: {
            '200': {
              description: 'Plugin disabled',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      // API Keys
      '/admin/keys': {
        get: {
          tags: ['Admin - API Keys'],
          summary: 'List API keys',
          description: 'Returns all configured API keys.',
          operationId: 'listApiKeys',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'API key list',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/ApiKey' }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        },
        post: {
          tags: ['Admin - API Keys'],
          summary: 'Create API key',
          description: 'Creates a new API key with optional rate limit and expiration.',
          operationId: 'createApiKey',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', description: 'Key name', example: 'Production API Key' },
                    rateLimit: { type: 'number', description: 'Requests per minute', example: 100 },
                    expiresIn: { type: 'number', description: 'Expiration in seconds', example: 86400 }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'API key created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ApiKeyCreated' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/keys/{key}': {
        delete: {
          tags: ['Admin - API Keys'],
          summary: 'Delete API key',
          description: 'Deletes an existing API key.',
          operationId: 'deleteApiKey',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'key',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'API key to delete'
            }
          ],
          responses: {
            '200': {
              description: 'API key deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      // Circuit Breakers
      '/admin/circuits': {
        get: {
          tags: ['Admin - Circuit Breakers'],
          summary: 'List circuit breaker states',
          description: 'Returns the current state of all circuit breakers.',
          operationId: 'getCircuits',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Circuit breaker states',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: {
                      $ref: '#/components/schemas/CircuitState'
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/admin/circuits/{service}/reset': {
        post: {
          tags: ['Admin - Circuit Breakers'],
          summary: 'Reset circuit breaker',
          description: 'Resets a circuit breaker to closed state for a specific service.',
          operationId: 'resetCircuit',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'service',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Service name'
            }
          ],
          responses: {
            '200': {
              description: 'Circuit reset',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      // Security
      '/admin/security/ddos': {
        get: {
          tags: ['Admin - Security'],
          summary: 'DDoS protection stats',
          description: 'Returns DDoS protection statistics. Requires admin role.',
          operationId: 'getDdosStats',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'DDoS statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      blockedIPs: { type: 'number' },
                      requestsBlocked: { type: 'number' },
                      activeThreats: { type: 'number' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/admin/security/blocked': {
        get: {
          tags: ['Admin - Security'],
          summary: 'List blocked IPs',
          description: 'Returns all currently blocked IP addresses. Requires admin role.',
          operationId: 'getBlockedIPs',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Blocked IP list',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        ip: { type: 'string' },
                        reason: { type: 'string' },
                        blockedAt: { type: 'string', format: 'date-time' }
                      }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/admin/security/unblock': {
        post: {
          tags: ['Admin - Security'],
          summary: 'Unblock an IP',
          description: 'Removes an IP address from the block list. Requires admin role.',
          operationId: 'unblockIP',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['ip'],
                  properties: {
                    ip: { type: 'string', description: 'IP address to unblock', example: '192.168.1.100' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'IP unblocked',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      // Cache
      '/admin/cache/clear': {
        post: {
          tags: ['Admin - Cache'],
          summary: 'Clear cache',
          description: 'Clears all cached responses. Requires admin role.',
          operationId: 'clearCache',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Cache cleared',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      message: { type: 'string' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/admin/cache/stats': {
        get: {
          tags: ['Admin - Cache'],
          summary: 'Cache statistics',
          description: 'Returns cache hit/miss statistics and connection pool info.',
          operationId: 'getCacheStats',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Cache statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      hits: { type: 'number' },
                      misses: { type: 'number' },
                      size: { type: 'number' },
                      connections: { type: 'number' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      // Proxy
      '/api/{path}': {
        get: {
          tags: ['Proxy'],
          summary: 'Proxy GET request',
          description: 'Routes the GET request to the configured upstream service.',
          operationId: 'proxyGet',
          parameters: [
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'API path to proxy'
            }
          ],
          responses: {
            '200': { description: 'Upstream response' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { $ref: '#/components/responses/BadGateway' }
          }
        },
        post: {
          tags: ['Proxy'],
          summary: 'Proxy POST request',
          description: 'Routes the POST request to the configured upstream service.',
          operationId: 'proxyPost',
          parameters: [
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'API path to proxy'
            }
          ],
          requestBody: {
            content: { 'application/json': {} }
          },
          responses: {
            '200': { description: 'Upstream response' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { $ref: '#/components/responses/BadGateway' }
          }
        },
        put: {
          tags: ['Proxy'],
          summary: 'Proxy PUT request',
          description: 'Routes the PUT request to the configured upstream service.',
          operationId: 'proxyPut',
          parameters: [
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'API path to proxy'
            }
          ],
          requestBody: {
            content: { 'application/json': {} }
          },
          responses: {
            '200': { description: 'Upstream response' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { $ref: '#/components/responses/BadGateway' }
          }
        },
        delete: {
          tags: ['Proxy'],
          summary: 'Proxy DELETE request',
          description: 'Routes the DELETE request to the configured upstream service.',
          operationId: 'proxyDelete',
          parameters: [
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'API path to proxy'
            }
          ],
          responses: {
            '200': { description: 'Upstream response' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { $ref: '#/components/responses/BadGateway' }
          }
        },
        patch: {
          tags: ['Proxy'],
          summary: 'Proxy PATCH request',
          description: 'Routes the PATCH request to the configured upstream service.',
          operationId: 'proxyPatch',
          parameters: [
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'API path to proxy'
            }
          ],
          requestBody: {
            content: { 'application/json': {} }
          },
          responses: {
            '200': { description: 'Upstream response' },
            '404': { $ref: '#/components/responses/NotFound' },
            '502': { $ref: '#/components/responses/BadGateway' }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /admin/login'
        }
      },
      schemas: {
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'healthy' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number', description: 'Uptime in seconds' },
            plugins: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of enabled plugin names'
            }
          }
        },
        DetailedHealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'healthy' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
            memory: {
              type: 'object',
              properties: {
                rss: { oneOf: [{ type: 'number' }, { type: 'string' }] },
                heapUsed: { oneOf: [{ type: 'number' }, { type: 'string' }] },
                heapTotal: { oneOf: [{ type: 'number' }, { type: 'string' }] }
              }
            },
            cpu: {
              type: 'object',
              properties: {
                user: { type: 'number' },
                system: { type: 'number' }
              }
            },
            plugins: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                enabled: { type: 'number' }
              }
            }
          }
        },
        StatsResponse: {
          type: 'object',
          properties: {
            uptime: { type: 'number' },
            memory: {
              type: 'object',
              properties: {
                rss: { type: 'number' },
                heapTotal: { type: 'number' },
                heapUsed: { type: 'number' },
                external: { type: 'number' }
              }
            },
            cpu: {
              type: 'object',
              properties: {
                user: { type: 'number' },
                system: { type: 'number' }
              }
            },
            timestamp: { type: 'string', format: 'date-time' },
            plugins: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                enabled: { type: 'number' }
              }
            }
          }
        },
        MetricsResponse: {
          type: 'object',
          properties: {
            requests: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                success: { type: 'number' },
                errors: { type: 'number' }
              }
            },
            latency: {
              type: 'object',
              properties: {
                avg: { type: 'number' },
                p95: { type: 'number' },
                p99: { type: 'number' }
              }
            }
          }
        },
        PluginListResponse: {
          type: 'object',
          properties: {
            available: {
              type: 'array',
              items: { type: 'string' }
            },
            enabled: {
              type: 'array',
              items: { $ref: '#/components/schemas/Plugin' }
            },
            count: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                enabled: { type: 'number' }
              }
            }
          }
        },
        Plugin: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            enabled: { type: 'boolean' },
            options: { type: 'object', additionalProperties: true }
          }
        },
        ApiKey: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'API key (masked)' },
            name: { type: 'string' },
            rateLimit: { type: 'number' },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        ApiKeyCreated: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Full API key (store securely, shown once)' },
            name: { type: 'string' },
            rateLimit: { type: 'number' },
            expiresIn: { type: 'number', description: 'Expiration in seconds' }
          }
        },
        CircuitState: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['closed', 'open', 'half-open'] },
            failures: { type: 'number' },
            lastFailure: { type: 'string', format: 'date-time', nullable: true },
            nextRetry: { type: 'string', format: 'date-time', nullable: true }
          }
        }
      },
      responses: {
        Unauthorized: {
          description: 'Authentication required or token invalid',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Unauthorized' }
                }
              }
            }
          }
        },
        Forbidden: {
          description: 'Insufficient permissions (admin role required)',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Forbidden' },
                  message: { type: 'string', example: 'Admin access required' }
                }
              }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Not Found' },
                  message: { type: 'string' }
                }
              }
            }
          }
        },
        BadRequest: {
          description: 'Invalid request',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Bad Request' },
                  message: { type: 'string' }
                }
              }
            }
          }
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Too Many Requests' }
                }
              }
            }
          }
        },
        BadGateway: {
          description: 'Upstream service unavailable',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Bad gateway' },
                  message: { type: 'string', example: 'Upstream service unavailable' }
                }
              }
            }
          }
        }
      }
    }
  };

  return spec;
}

// Inject enabled plugins info into the spec
function enrichSpecWithPlugins(spec) {
  const enabledPlugins = pluginManager.getEnabledPlugins();
  const enabledNames = enabledPlugins.map(p => p.name);

  // Add enabled plugins section
  spec['x-enabled-plugins'] = enabledNames;

  // Add plugin categories with status
  spec['x-plugin-categories'] = {};
  for (const [category, plugins] of Object.entries(PLUGIN_CATEGORIES)) {
    spec['x-plugin-categories'][category] = plugins.map(name => ({
      name,
      enabled: enabledNames.includes(name)
    }));
  }

  // Add enabled plugin configs (sanitized)
  spec['x-plugin-configs'] = {};
  for (const plugin of enabledPlugins) {
    const config = { ...plugin.options };
    // Remove sensitive fields
    delete config.secret;
    delete config.password;
    spec['x-plugin-configs'][plugin.name] = config;
  }

  return spec;
}

// Serve OpenAPI JSON spec
router.get('/openapi.json', (req, res) => {
  const spec = enrichSpecWithPlugins(generateOpenAPISpec());
  res.json(spec);
});

// Serve OpenAPI YAML (basic conversion)
router.get('/openapi.yaml', (req, res) => {
  const spec = enrichSpecWithPlugins(generateOpenAPISpec());
  res.set('Content-Type', 'text/yaml');
  res.send(JSON.stringify(spec, null, 2));
});

export { generateOpenAPISpec, enrichSpecWithPlugins, PLUGIN_CATEGORIES };
export default router;
