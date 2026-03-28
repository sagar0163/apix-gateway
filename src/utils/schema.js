/**
 * APIX Gateway Configuration Schema
 * JSON Schema for validating apix.yaml files
 */

export const configSchema = {
  type: 'object',
  properties: {
    version: {
      type: 'string',
      description: 'Config schema version',
      default: '1.0'
    },

    server: {
      type: 'object',
      properties: {
        port: { type: 'number', minimum: 1, maximum: 65535, default: 3000 },
        host: { type: 'string', default: '0.0.0.0' },
        trustProxy: { type: 'boolean', default: true }
      }
    },

    jwt: {
      type: 'object',
      properties: {
        secret: { type: 'string', minLength: 32 },
        expiresIn: { type: 'string', default: '24h' }
      }
    },

    cors: {
      type: 'object',
      properties: {
        origin: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } }
          ]
        },
        methods: { type: 'array', items: { type: 'string' } },
        credentials: { type: 'boolean' }
      }
    },

    redis: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        password: { type: 'string' },
        db: { type: 'number' }
      }
    },

    upstreams: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          targets: { type: 'array', items: { type: 'string', format: 'uri' } },
          strategy: {
            type: 'string',
            enum: ['round-robin', 'random', 'least-connections', 'weighted', 'ip-hash']
          },
          healthCheck: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              path: { type: 'string' },
              interval: { type: 'number' },
              timeout: { type: 'number' }
            }
          }
        }
      }
    },

    routes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'upstream'],
        properties: {
          path: { type: 'string', pattern: '^/' },
          upstream: { type: 'string' },
          target: { type: 'string', format: 'uri' },
          methods: { type: 'array', items: { type: 'string' } },
          stripPrefix: { type: 'boolean', default: true },
          plugins: {
            type: 'object',
            additionalProperties: {
              oneOf: [
                { type: 'boolean' },
                { type: 'object' }
              ]
            }
          }
        }
      }
    },

    plugins: {
      type: 'object',
      additionalProperties: {
        oneOf: [
          { type: 'boolean' },
          {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' }
            }
          }
        ]
      }
    },

    logging: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
        format: { type: 'string', enum: ['json', 'text'] },
        file: { type: 'string' }
      }
    }
  }
};
