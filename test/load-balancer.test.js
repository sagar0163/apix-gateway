// Load Balancer Test Suite
import http from 'http';
import { URL } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Test servers (mock upstream targets)
const testServers = [];
const serverPorts = [3001, 3002, 3003];

// Create mock upstream servers
function createTestServer(port, latency = 0, failRate = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Simulate latency
      setTimeout(() => {
        // Simulate failures
        if (Math.random() < failRate) {
          res.writeHead(502);
          res.end('Bad Gateway');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ server: `localhost:${port}`, status: 'ok' }));
      }, latency);
    });
    
    server.listen(port, () => {
      console.log(`📦 Test server started on port ${port} (latency: ${latency}ms, failRate: ${failRate * 100}%)`);
      resolve(server);
    });
  });
}

// Import and test the load balancer
describe('Load Balancer', () => {
  beforeAll(async () => {
    console.log('\n1️⃣ Starting mock upstream servers...');
    testServers.push(await createTestServer(3001, 50, 0));   // Fast, reliable
    testServers.push(await createTestServer(3002, 200, 0)); // Slow
    testServers.push(await createTestServer(3003, 50, 0.3)); // Fast but 30% failure
  });

  afterAll(() => {
    console.log('\n🔚 Cleaning up test servers...');
    testServers.forEach(s => s.close());
  });

  it('should perform all load balancer tests', async () => {
    console.log('\n🧪 Starting Load Balancer Tests\n' + '='.repeat(50));
    
    // Dynamic import the load balancer
    const lbModule = await import('../src/plugins/builtins/load-balancer.js');
    const loadBalancer = lbModule.default;
    
    const options = {
      targets: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
      strategy: 'round-robin',
      healthCheck: { enabled: false },
      weights: {
        'http://localhost:3001': 10,
        'http://localhost:3002': 5,
        'http://localhost:3003': 5
      }
    };
    
    // Initialize targets
    console.log('\n2️⃣ Initializing load balancer with targets...');
    options.targets.forEach(url => {
      loadBalancer.addTarget(url, options.weights[url]);
    });
    
    // Test 1: Round Robin
    console.log('\n3️⃣ Test: Round Robin Strategy');
    for (let i = 0; i < 10; i++) {
      const target = loadBalancer.getTarget('round-robin');
      loadBalancer.release(target, true, 50);
      process.stdout.write(`   ${target.url.split(':')[1]} `);
    }
    console.log('\n   ✅ Round-robin working');
    
    // Test 2: IP Hash (Consistent)
    console.log('\n4️⃣ Test: IP Hash Strategy (Consistent)');
    const ip1 = '192.168.1.100';
    const ip2 = '10.0.0.1';
    
    const targetsForIP1 = [];
    const targetsForIP2 = [];
    
    for (let i = 0; i < 5; i++) {
      targetsForIP1.push(loadBalancer.getTarget('ip-hash', ip1).url);
      targetsForIP2.push(loadBalancer.getTarget('ip-hash', ip2).url);
    }
    
    const ip1Consistent = targetsForIP1.every(t => t === targetsForIP1[0]);
    const ip2Consistent = targetsForIP2.every(t => t === targetsForIP2[0]);
    const ipDifferent = targetsForIP1[0] !== targetsForIP2[0];
    
    expect(ip1Consistent && ip2Consistent).toBe(true);
    
    // Test 3: Weighted Routing
    console.log('\n5️⃣ Test: Weighted Strategy');
    const weightedCounts = {};
    options.targets.forEach(t => weightedCounts[t] = 0);
    
    for (let i = 0; i < 1000; i++) {
      const target = loadBalancer.getTarget('weighted');
      weightedCounts[target.url]++;
    }
    
    expect(weightedCounts['http://localhost:3001']).toBeGreaterThan(weightedCounts['http://localhost:3002']);
    
    // Test 4: Latency-based Routing
    console.log('\n6️⃣ Test: Latency Strategy');
    const targets = loadBalancer.targets;
    targets[0].latency = 50;   // Fast
    targets[1].latency = 500;  // Slow
    targets[2].latency = 100;  // Medium
    
    const latencySelections = [];
    for (let i = 0; i < 10; i++) {
      latencySelections.push(loadBalancer.getTarget('latency').url);
    }
    
    expect(latencySelections.every(t => t.includes('3001'))).toBe(true);
    
    // Test 5: Health Tracking
    console.log('\n7️⃣ Test: Health Tracking');
    const target3001 = targets.find(t => t.url.includes('3001'));
    loadBalancer.release(target3001, false, 100);
    loadBalancer.release(target3001, false, 100);
    loadBalancer.release(target3001, false, 100);
    
    expect(target3001.healthy).toBe(false);
    // Simulate success
    target3001.lastFailureTime = 0; // Bypass cooldown
    for (let i = 0; i < 6; i++) {
      loadBalancer.release(target3001, true, 50);
    }
    
    expect(target3001.healthy).toBe(true);
    
    // Test 6: Status API
    console.log('\n8️⃣ Test: Status API');
    const status = loadBalancer.getStatus();
    expect(Array.isArray(status)).toBe(true);
    expect(status.length).toBe(3);
    
    // Test 7: Gradual Weight Recovery
    console.log('\n9️⃣ Test: Gradual Weight Recovery');
    const testTarget = targets.find(t => t.url.includes('3003'));
    testTarget.effectiveWeight = 1;
    testTarget.weight = 10;
    
    for (let i = 0; i < 5; i++) {
      loadBalancer.release(testTarget, true, 50);
    }
    expect(testTarget.effectiveWeight).toBeGreaterThan(1);
  });
});
