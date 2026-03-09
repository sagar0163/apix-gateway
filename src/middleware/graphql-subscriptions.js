// GraphQL Subscriptions Support
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// Subscription storage
const subscriptions = new Map();
const topics = new Map();

// Event emitter for pub/sub
const emitter = {
  listeners: new Map(),
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    return () => {
      this.listeners.get(event).delete(callback);
    };
  },
  
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(data);
        } catch (err) {
          logger.error('Subscription emit error:', err.message);
        }
      }
    }
  },
  
  off(event, callback) {
    if (callback) {
      this.listeners.get(event)?.delete(callback);
    } else {
      this.listeners.delete(event);
    }
  }
};

// Generate subscription ID
const generateSubId = () => crypto.randomUUID();

// Create GraphQL subscription endpoint
export const createSubscriptionServer = (options = {}) => {
  const {
    path = '/graphql subscriptions',
    keepAlive = 15000
  } = options;

  return (req, res, next) => {
    if (!req.path.startsWith(path)) {
      return next();
    }

    // Handle WebSocket upgrade for subscriptions
    const isWS = req.headers upgrade && req.headers upgrade.toLowerCase() === 'websocket';
    
    if (req.method === 'GET' && req.query?.query) {
      // GraphQL query execution
      return next();
    }
    
    if (req.method === 'POST' && req.body?.query) {
      // Handle subscriptions in query
      const { query, variables, operationName } = req.body;
      
      if (query.includes('subscription')) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Use WebSocket for subscriptions'
        });
      }
      
      return next();
    }

    next();
  };
};

// Subscribe to a topic
export const subscribe = (topic, callback) => {
  const id = generateSubId();
  
  if (!topics.has(topic)) {
    topics.set(topic, new Set());
  }
  
  topics.get(topic).add(id);
  subscriptions.set(id, { topic, callback, createdAt: Date.now() });
  
  logger.debug(`Subscription created: ${id} for topic: ${topic}`);
  
  // Return unsubscribe function
  return () => unsubscribe(id);
};

// Unsubscribe
const unsubscribe = (id) => {
  const sub = subscriptions.get(id);
  if (sub) {
    topics.get(sub.topic)?.delete(id);
    subscriptions.delete(id);
    logger.debug(`Subscription removed: ${id}`);
  }
};

// Publish to a topic
export const publish = (topic, payload) => {
  logger.debug(`Publishing to topic: ${topic}`);
  emitter.emit(topic, payload);
  
  // Send to all subscribers
  if (topics.has(topic)) {
    for (const subId of topics.get(topic)) {
      const sub = subscriptions.get(subId);
      if (sub?.callback) {
        try {
          sub.callback(payload);
        } catch (err) {
          logger.error(`Subscription callback error for ${subId}:`, err.message);
        }
      }
    }
  }
};

// GraphQL subscription resolver helper
export const withFilter = (filterFn) => {
  return (asyncIterator, filter) => {
    const buffer = [];
    
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (true) {
          let value;
          let done = false;
          
          // Get next value from iterator
          const result = await asyncIterator.next();
          value = result.value;
          done = result.done;
          
          if (done) {
            return { done, value };
          }
          
          // Apply filter
          if (await filterFn(value, filter)) {
            return { done: false, value };
          }
          
          // Buffer for later if needed
          if (buffer.length < 100) {
            buffer.push(value);
          }
        }
      }
    };
  };
};

// PubSub event emitter
export const pubsub = {
  subscribe,
  publish,
  
  // Create async iterator for subscription
  asyncIterator(topic) {
    const queue = [];
    let resolve;
    let promise;
    
    const getNext = () => {
      if (queue.length > 0) {
        return Promise.resolve({ done: false, value: queue.shift() });
      }
      
      promise = new Promise((r) => { resolve = r; });
      
      const unsubscribe = subscribe(topic, (payload) => {
        queue.push(payload);
        if (resolve) {
          resolve({ done: false, value: payload });
          resolve = null;
          promise = null;
        }
      });
      
      return promise;
    };
    
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return getNext();
      },
      async return() {
        return { done: true };
      }
    };
  }
};

// Get subscription stats
export const getSubscriptionStats = () => {
  const topicStats = {};
  
  for (const [topic, subs] of topics.entries()) {
    topicStats[topic] = subs.size;
  }
  
  return {
    totalSubscriptions: subscriptions.size,
    topics: topicStats,
    uptime: process.uptime()
  };
};

// Cleanup stale subscriptions
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const maxAge = 3600000; // 1 hour
  
  for (const [id, sub] of subscriptions.entries()) {
    if (now - sub.createdAt > maxAge) {
      unsubscribe(id);
    }
  }
}, 300000); // Check every 5 minutes

process.on('SIGTERM', () => clearInterval(cleanupInterval));

export default {
  createSubscriptionServer,
  subscribe,
  publish,
  pubsub,
  withFilter,
  getSubscriptionStats
};
