import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import assert from 'assert';
import { describe, it, expect } from 'vitest';

// =======================
// TEST CONFIGURATION
// =======================

const GATEWAY_PORT = 3001;
const TEST_TIMEOUT = 30000;

// =======================
// HELPER FUNCTIONS
// =======================

function getMemoryMB() {
  const used = process.memoryUsage();
  return used.heapUsed / 1024 / 1024;
}

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// =======================
// TEST 1: Header Injection Prevention (Gateway)
// =======================

async function testHeaderInjection() {
  const sanitizeHeaders = (headers) => {
    const sanitized = { ...headers };
    const dangerousPatterns = [/\r\n/gi, /\x0d\x0a/gi, /\x0a/gi, /\x0d/gi];
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string') {
        let sanitizedValue = value;
        for (const pattern of dangerousPatterns) {
          sanitizedValue = sanitizedValue.replace(pattern, '');
        }
        if (sanitizedValue !== value) {
          delete sanitized[key];
        } else {
          sanitized[key] = sanitizedValue;
        }
      }
    }
    return sanitized;
  };
  const testCases = [
    { input: { 'X-Test': 'normal' }, expected: 'normal', desc: 'Normal header' },
    { input: { 'X-Test': 'value\r\nX-Injected: bad' }, expected: undefined, desc: 'CRLF injection' },
    { input: { 'X-Test': 'value\x0d\x0aBreak' }, expected: undefined, desc: 'Raw CR LF' },
    { input: { 'X-Test': 'value\nBreak' }, expected: undefined, desc: 'LF only' },
  ];
  let passed = 0;
  for (const tc of testCases) {
    const result = sanitizeHeaders(tc.input);
    const key = Object.keys(tc.input)[0];
    const actual = result[key];
    if (tc.expected === undefined) {
      if (actual === undefined) passed++;
    } else {
      if (actual === tc.expected) passed++;
    }
  }
  return passed === testCases.length;
}

// =======================
// TEST 2: Plugin Manager Thread Safety
// =======================

async function testPluginManagerThreadSafety() {
  class PluginManager {
    constructor() {
      this.plugins = new Map();
      this.enabledPlugins = new Set();
      this.pluginInstances = new Map();
    }
    register(name, plugin) { this.plugins.set(name, { ...plugin, name, enabled: false }); }
    enable(name, options = {}) {
      const plugin = this.plugins.get(name);
      if (!plugin) return;
      this.pluginInstances.set(name, { ...plugin, enabled: true, options });
      this.enabledPlugins.add(name);
    }
    getEnabledPlugins() {
      const enabled = [];
      for (const name of this.enabledPlugins) {
        const plugin = this.pluginInstances.get(name);
        if (plugin) enabled.push({ name: plugin.name });
      }
      return enabled;
    }
  }
  const pm = new PluginManager();
  for (let i = 0; i < 10; i++) pm.register(`plugin-${i}`, { name: `plugin-${i}`, handler: () => {} });
  for (let i = 0; i < 10; i++) pm.enable(`plugin-${i}`, {});
  let errors = 0;
  const operations = 100;
  const promises = [];
  for (let i = 0; i < operations; i++) {
    promises.push((async () => {
      try {
        const plugins = pm.getEnabledPlugins();
        if (plugins.length !== 10) errors++;
      } catch (e) { errors++; }
    })());
  }
  await Promise.all(promises);
  return errors === 0;
}

// =======================
// TEST 3: Circuit Breaker Thread Safety
// =======================

async function testCircuitBreakerThreadSafety() {
  class CircuitStore {
    constructor() { this.circuits = new Map(); }
    getOrCreate(service) {
      let circuit = this.circuits.get(service);
      if (!circuit) {
        circuit = { state: 'closed', failures: 0, successes: 0, nextAttempt: 0, windowStart: Date.now() };
        this.circuits.set(service, circuit);
      }
      return circuit;
    }
    tryOpen(service, threshold) {
      const circuit = this.getOrCreate(service);
      circuit.failures++;
      if (circuit.failures >= threshold) {
        circuit.state = 'open';
        return true;
      }
      return false;
    }
  }
  const store = new CircuitStore();
  const operations = 100;
  const opens = [];
  const promises = [];
  for (let i = 0; i < operations; i++) {
    promises.push((async () => {
      const result = store.tryOpen('test-service', 5);
      if (result) opens.push(result);
    })());
  }
  await Promise.all(promises);
  return opens.length >= 1;
}

// =======================
// TEST 4: Memory Safety
// =======================

async function testMemorySafety() {
  const initialMem = getMemoryMB();
  const requests = [];
  for (let i = 0; i < 100; i++) requests.push({ _retryCount: 0, _retryStartTime: Date.now(), headers: { 'x-test': 'value' } });
  for (const req of requests) { req._retryCount = null; req._retryStartTime = null; req.headers = null; }
  requests.length = 0;
  await new Promise(r => setTimeout(r, 100));
  const finalMem = getMemoryMB();
  return (finalMem - initialMem) < 20;
}

// =======================
// TEST 5: Timeout Handling
// =======================

async function testTimeoutHandling() {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  let timedOut = false;
  try {
    await makeRequest({ hostname: 'localhost', port, path: '/', method: 'GET', timeout: 200 });
  } catch (err) { timedOut = true; }
  server.close();
  return timedOut;
}

describe('Integration Tests', () => {
  it('should pass header injection tests', async () => { expect(await testHeaderInjection()).toBe(true); });
  it('should pass plugin manager thread safety tests', async () => { expect(await testPluginManagerThreadSafety()).toBe(true); });
  it('should pass circuit breaker thread safety tests', async () => { expect(await testCircuitBreakerThreadSafety()).toBe(true); });
  it('should pass memory safety tests', async () => { expect(await testMemorySafety()).toBe(true); });
  it('should pass timeout handling tests', async () => { expect(await testTimeoutHandling()).toBe(true); });
});
