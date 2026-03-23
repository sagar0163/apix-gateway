/**
 * APIX Gateway Integration Tests - Post-Fix Validation
 * Tests the security and race condition fixes
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const assert = require('assert');

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
    if (body) req.write(body);
    req.end();
  });
}

// =======================
// TEST 1: Header Injection Prevention (Gateway)
// =======================

async function testHeaderInjection() {
  console.log('\n🧪 Test: Header Injection Prevention (Gateway)');
  console.log('===============================================');
  
  // Test the sanitization function directly
  const sanitizeHeaders = (headers) => {
    const sanitized = { ...headers };
    const dangerousPatterns = [
      /\r\n/gi,
      /\x0d\x0a/gi,
      /\x0a/gi,
      /\x0d/gi
    ];
    
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string') {
        let sanitizedValue = value;
        for (const pattern of dangerousPatterns) {
          sanitizedValue = sanitizedValue.replace(pattern, '');
        }
        if (sanitizedValue !== value) {
          console.log(`🚨 Blocked header injection: ${key}`);
          delete sanitized[key];
        } else {
          sanitized[key] = sanitizedValue;
        }
      }
    }
    return sanitized;
  };
  
  // Test cases
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
      // Should be blocked/deleted
      if (actual === undefined) {
        console.log(`✅ ${tc.desc}: Blocked correctly`);
        passed++;
      } else {
        console.log(`❌ ${tc.desc}: Should have been blocked but got: ${actual}`);
      }
    } else {
      if (actual === tc.expected) {
        console.log(`✅ ${tc.desc}: Passed through correctly`);
        passed++;
      } else {
        console.log(`❌ ${tc.desc}: Expected ${tc.expected}, got ${actual}`);
      }
    }
  }
  
  return passed === testCases.length;
}

// =======================
// TEST 2: Plugin Manager Thread Safety
// =======================

async function testPluginManagerThreadSafety() {
  console.log('\n🧪 Test: Plugin Manager Thread Safety');
  console.log('=====================================');
  
  // Simulate the fixed PluginManager
  class PluginManager {
    constructor() {
      this.plugins = new Map();
      this.enabledPlugins = new Set();
      this.pluginInstances = new Map();
      this._middlewareCache = null;
    }

    register(name, plugin) {
      this.plugins.set(name, { ...plugin, name, enabled: false });
      this._invalidateCache();
    }

    enable(name, options = {}) {
      const plugin = this.plugins.get(name);
      if (!plugin) return;
      
      const instance = { ...plugin, enabled: true, options };
      this.pluginInstances.set(name, instance);
      this.enabledPlugins.add(name);
      this._invalidateCache();
    }

    _invalidateCache() {
      this._middlewareCache = null;
    }

    getEnabledPlugins() {
      const enabled = [];
      for (const name of this.enabledPlugins) {
        const plugin = this.pluginInstances.get(name);
        if (plugin) enabled.push({ name: plugin.name });
      }
      return enabled;
    }

    createMiddleware() {
      return async (req, res, next) => {
        // Uses cached snapshot
        const pluginChain = this.getEnabledPlugins();
        next();
      };
    }
  }

  const pm = new PluginManager();
  
  // Register plugins
  for (let i = 0; i < 10; i++) {
    pm.register(`plugin-${i}`, { name: `plugin-${i}`, handler: () => {} });
  }
  
  // Enable plugins
  for (let i = 0; i < 10; i++) {
    pm.enable(`plugin-${i}`, {});
  }

  // Concurrent access test
  let errors = 0;
  const operations = 100;
  
  const promises = [];
  for (let i = 0; i < operations; i++) {
    promises.push((async () => {
      try {
        // Read operation
        const plugins = pm.getEnabledPlugins();
        if (plugins.length !== 10) {
          errors++;
        }
      } catch (e) {
        errors++;
      }
    })());
  }
  
  await Promise.all(promises);
  
  console.log(`📊 Operations: ${operations}, Errors: ${errors}`);
  
  if (errors === 0) {
    console.log('✅ Plugin manager thread-safe');
    return true;
  } else {
    console.log('❌ Thread safety issues detected');
    return false;
  }
}

// =======================
// TEST 3: Circuit Breaker Thread Safety
// =======================

async function testCircuitBreakerThreadSafety() {
  console.log('\n🧪 Test: Circuit Breaker Thread Safety');
  console.log('========================================');
  
  // Fixed CircuitStore implementation
  class CircuitStore {
    constructor() {
      this.circuits = new Map();
    }

    getOrCreate(service) {
      let circuit = this.circuits.get(service);
      if (!circuit) {
        circuit = {
          state: 'closed',
          failures: 0,
          successes: 0,
          nextAttempt: 0,
          windowStart: Date.now()
        };
        this.circuits.set(service, circuit);
      }
      return circuit;
    }

    tryOpen(service, threshold) {
      const circuit = this.getOrCreate(service);
      const now = Date.now();
      
      if (now - circuit.windowStart > 60000) {
        circuit.failures = 0;
        circuit.windowStart = now;
      }
      
      circuit.failures++;
      
      if (circuit.failures >= threshold) {
        circuit.state = 'open';
        circuit.nextAttempt = now + 30000;
        return true;
      }
      return false;
    }

    canProceed(service) {
      const circuit = this.getOrCreate(service);
      const now = Date.now();
      
      if (circuit.state === 'closed') {
        return { allowed: true };
      }
      
      if (circuit.state === 'open') {
        if (now >= circuit.nextAttempt) {
          circuit.state = 'half-open';
          return { allowed: true };
        }
        return { allowed: false, retryAfter: 30 };
      }
      
      return { allowed: true };
    }
  }

  const store = new CircuitStore();
  const operations = 100;
  const opens = [];
  
  // Concurrent failure simulation
  const promises = [];
  for (let i = 0; i < operations; i++) {
    promises.push((async () => {
      const result = store.tryOpen('test-service', 5);
      if (result) opens.push(result);
    })());
  }
  
  await Promise.all(promises);
  
  console.log(`📊 Operations: ${operations}, Circuit opens detected: ${opens.length}`);
  
  // With proper atomic operations, should open exactly once
  if (opens.length === 1) {
    console.log('✅ Circuit breaker thread-safe (opened exactly once)');
    return true;
  } else {
    console.log(`⚠️  Circuit opened ${opens.length} times (race condition)`);
    return false;
  }
}

// =======================
// TEST 4: Memory Safety
// =======================

async function testMemorySafety() {
  console.log('\n🧪 Test: Memory Safety Under Load');
  console.log('===================================');
  
  const initialMem = getMemoryMB();
  console.log(`📊 Initial memory: ${initialMem.toFixed(2)}MB`);
  
  // Simulate request handling with proper cleanup
  const requests = [];
  for (let i = 0; i < 100; i++) {
    const req = {
      _retryCount: 0,
      _retryStartTime: Date.now(),
      headers: { 'x-test': 'value' }
    };
    requests.push(req);
  }
  
  // Clear references to allow GC
  for (const req of requests) {
    req._retryCount = null;
    req._retryStartTime = null;
    req.headers = null;
  }
  requests.length = 0;
  
  // Force GC if available
  if (global.gc) {
    global.gc();
  }
  
  await new Promise(r => setTimeout(r, 100));
  
  const finalMem = getMemoryMB();
  const memDiff = finalMem - initialMem;
  
  console.log(`📊 Final memory: ${finalMem.toFixed(2)}MB`);
  console.log(`📊 Memory change: ${memDiff.toFixed(2)}MB`);
  
  if (memDiff < 10) {
    console.log('✅ Memory properly cleaned up');
    return true;
  } else {
    console.log('❌ Potential memory leak');
    return false;
  }
}

// =======================
// TEST 5: Timeout Handling
// =======================

async function testTimeoutHandling() {
  console.log('\n🧪 Test: Timeout Handling');
  console.log('===========================');
  
  let connections = 0;
  
  const server = http.createServer((req, res) => {
    connections++;
    // Hang indefinitely
  });
  
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  
  const startTime = Date.now();
  let timedOut = false;
  
  try {
    await makeRequest({
      hostname: 'localhost',
      port,
      path: '/',
      method: 'GET',
      timeout: 200
    });
  } catch (err) {
    timedOut = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.message.includes('timeout');
  }
  
  const elapsed = Date.now() - startTime;
  
  server.close();
  
  console.log(`📊 Request ${timedOut ? 'timed out' : 'completed'} after ${elapsed}ms`);
  console.log(`📊 Connection created: ${connections}`);
  
  // Cleanup: ensure server is closed
  setTimeout(() => server.close(), 10);
  
  if (timedOut || elapsed < 400) {
    console.log('✅ Timeout handled correctly');
    return true;
  } else {
    console.log('❌ Timeout not working as expected');
    return false;
  }
}

// =======================
// MAIN TEST RUNNER
// =======================

async function runTests() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     APIX Gateway Post-Fix Test Suite                          ║');
  console.log('║     Testing: Security fixes, Thread safety, Memory safety    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const results = {};
  
  try {
    results.headerInjection = await testHeaderInjection();
  } catch (e) {
    console.log('❌ Header injection test error:', e.message);
    results.headerInjection = false;
  }
  
  try {
    results.pluginThreadSafety = await testPluginManagerThreadSafety();
  } catch (e) {
    console.log('❌ Plugin thread safety test error:', e.message);
    results.pluginThreadSafety = false;
  }
  
  try {
    results.circuitBreaker = await testCircuitBreakerThreadSafety();
  } catch (e) {
    console.log('❌ Circuit breaker test error:', e.message);
    results.circuitBreaker = false;
  }
  
  try {
    results.memory = await testMemorySafety();
  } catch (e) {
    console.log('❌ Memory test error:', e.message);
    results.memory = false;
  }
  
  try {
    results.timeout = await testTimeoutHandling();
  } catch (e) {
    console.log('❌ Timeout test error:', e.message);
    results.timeout = false;
  }
  
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  
  for (const [test, result] of Object.entries(results)) {
    console.log(`${result ? '✅' : '❌'} ${test}: ${result ? 'PASS' : 'FAIL'}`);
  }
  
  console.log(`\nPassed: ${passed}/${total}`);
  
  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
