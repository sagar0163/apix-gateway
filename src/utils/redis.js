// Redis Manager - Centralized Redis connection management
import redis from 'redis';
const { createClient } = redis;
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  // Initialize Redis connection
  async connect() {
    const config = loadConfig();
    const redisConfig = config.redis || {};

    // Skip if Redis not configured
    if (!redisConfig.url && !redisConfig.host) {
      logger.warn('Redis not configured - skipping connection');
      return false;
    }

    const url = redisConfig.url || `redis://${redisConfig.host || 'localhost'}:${redisConfig.port || 6379}`;

    try {
      this.client = createClient({
        url,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('Redis max reconnection attempts reached');
              return new Error('Max retries reached');
            }
            return Math.min(retries * 100, 3000);
          }
        },
        ...redisConfig.options
      });

      this.client.on('error', (err) => {
        logger.error('Redis error:', err.message);
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info(`Redis connected: ${url}`);
      });

      this.client.on('disconnect', () => {
        this.isConnected = false;
        logger.warn('Redis disconnected');
      });

      // Add a connection timeout to prevent startup hangs
      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timed out')), 2000)
      );

      await Promise.race([connectPromise, timeoutPromise]);
      return true;
    } catch (err) {
      logger.error('Failed to connect to Redis:', err.message);
      // Ensure client is cleaned up if connection failed/timed out
      if (this.client) {
        this.client.disconnect().catch(() => {});
      }
      return false;
    }
  }

  // Get Redis client
  getClient() {
    return this.client;
  }

  // Check if connected
  isReady() {
    return this.isConnected && this.client?.isOpen;
  }

  // Generic cache operations
  async get(key) {
    if (!this.isReady()) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      logger.error('Redis get error:', err.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 3600) {
    if (!this.isReady()) return false;
    try {
      await this.client.setEx(key, ttlSeconds, value);
      return true;
    } catch (err) {
      logger.error('Redis set error:', err.message);
      return false;
    }
  }

  async del(key) {
    if (!this.isReady()) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      logger.error('Redis del error:', err.message);
      return false;
    }
  }

  // Increment with TTL (for rate limiting)
  async increment(key, windowSeconds = 60) {
    if (!this.isReady()) return null;
    try {
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      return current;
    } catch (err) {
      logger.error('Redis increment error:', err.message);
      return null;
    }
  }

  // Get TTL
  async ttl(key) {
    if (!this.isReady()) return -2;
    try {
      return await this.client.ttl(key);
    } catch (err) {
      return -2;
    }
  }

  // Hash operations
  async hGet(key, field) {
    if (!this.isReady()) return null;
    try {
      return await this.client.hGet(key, field);
    } catch (err) {
      return null;
    }
  }

  async hSet(key, field, value, ttlSeconds) {
    if (!this.isReady()) return false;
    try {
      await this.client.hSet(key, field, value);
      if (ttlSeconds) {
        await this.client.expire(key, ttlSeconds);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  // Pub/Sub
  async publish(channel, message) {
    if (!this.isReady()) return false;
    try {
      await this.client.publish(channel, message);
      return true;
    } catch (err) {
      return false;
    }
  }

  async subscribe(channel, callback) {
    if (!this.isReady()) return;
    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();
      await subscriber.subscribe(channel, (message) => {
        callback(message);
      });
      return subscriber;
    } catch (err) {
      logger.error('Redis subscribe error:', err.message);
    }
  }

  // Close connection
  async disconnect() {
    if (this.client?.isOpen) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  // Health check
  async ping() {
    if (!this.isReady()) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (err) {
      return false;
    }
  }
}

// Singleton instance
export const redisManager = new RedisManager();
export default redisManager;
// Safe Redis connection manager


// Hardening Audit: v1.2.0 - Verified by Sagar Jadhav
