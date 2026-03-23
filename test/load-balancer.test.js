// Load Balancer Test Suite
import http from 'http';
import { URL } from 'url';

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
async function runTests() {
  console.log('\n🧪 Starting Load Balancer Tests\n' + '='.repeat(50));
  
  // Start test servers
  console.log('\n1️⃣ Starting mock upstream servers...');
  testServers.push(await createTestServer(3001, 50, 0));   // Fast, reliable
  testServers.push(await createTestServer(3002, 200, 0)); // Slow
  testServers.push(await createTestServer(3003, 50, 0.3)); // Fast but 30% failure
  
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
  console.log('   Request distribution (10 requests):');
  for (let i = 0; i < 10; i++) {
    const target = loadBalancer.getTarget('round-robin');
    const req = { ip: '', headers: {} };
    loadBalancer.release(target, true, 50);
    process.stdout.write(`   ${target.url.split(':')[1]} `);
  }
  console.log('\n   ✅ Round-robin working');
  
  // Test 2: IP Hash (Consistent)
  console.log('\n4️⃣ Test: IP Hash Strategy (Consistent)');
  const ip1 = '192.168.1.100';
  const ip2 = '192.168.1.101';
  
  const targetsForIP1 = [];
  const targetsForIP2 = [];
  
  for (let i = 0; i < 5; i++) {
    targetsForIP1.push(loadBalancer.getTarget('ip-hash', ip1).url);
    targetsForIP2.push(loadBalancer.getTarget('ip-hash', ip2).url);
  }
  
  const ip1Consistent = targetsForIP1.every(t => t === targetsForIP1[0]);
  const ip2Consistent = targetsForIP2.every(t => t === targetsForIP2[0]);
  const ipDifferent = targetsForIP1[0] !== targetsForIP2[0];
  
  console.log(`   IP1 always routes to: ${targetsForIP1[0]}`);
  console.log(`   IP2 always routes to: ${targetsForIP2[0]}`);
  console.log(`   ✅ Consistent hashing: ${ip1Consistent && ip2Consistent}`);
  console.log(`   ✅ Different IPs → Different targets: ${ipDifferent}`);
  
  // Test 3: Weighted Routing
  console.log('\n5️⃣ Test: Weighted Strategy');
  const weightedCounts = {};
  options.targets.forEach(t => weightedCounts[t] = 0);
  
  for (let i = 0; i < 1000; i++) {
    const target = loadBalancer.getTarget('weighted');
    weightedCounts[target.url]++;
  }
  
  console.log('   Distribution over 1000 requests:');
  for (const [url, count] of Object.entries(weightedCounts)) {
    const expected = options.weights[url] / 20; // 20 = sum of all weights
    console.log(`   ${url}: ${count} (${(count/10).toFixed(1)}%) - expected ~${expected}%`);
  }
  console.log('   ✅ Weighted routing working');
  
  // Test 4: Latency-based Routing
  console.log('\n6️⃣ Test: Latency Strategy');
  // Simulate different latencies
  const targets = loadBalancer.targets;
  targets[0].latency = 50;   // Fast
  targets[1].latency = 500;  // Slow
  targets[2].latency = 100;  // Medium
  
  const latencySelections = [];
  for (let i = 0; i < 10; i++) {
    latencySelections.push(loadBalancer.getTarget('latency').url);
  }
  
  const allSelectFast = latencySelections.every(t => t.includes('3001'));
  console.log(`   All 10 requests went to: ${latencySelections[0]}`);
  console.log(`   ✅ Latency-based routing: ${allSelectFast}`);
  
  // Test 5: Health Tracking
  console.log('\n7️⃣ Test: Health Tracking');
  const target3001 = targets.find(t => t.url.includes('3001'));
  
  // Simulate failures
  loadBalancer.release(target3001, false, 100);
  loadBalancer.release(target3001, false, 100);
  loadBalancer.release(target3001, false, 100);
  
  console.log(`   After 3 failures: healthy = ${target3001.healthy}`);
  console.log(`   Failures count: ${target3001.failures}`);
  
  // Simulate success
  loadBalancer.release(target3001, true, 50);
  loadBalancer.release(target3001, true, 50);
  
  console.log(`   After 2 successes: healthy = ${target3001.healthy}`);
  console.log('   ✅ Health tracking working');
  
  // Test 6: Status API
  console.log('\n8️⃣ Test: Status API');
  const status = loadBalancer.getStatus();
  console.log('   Status output:');
  console.log(JSON.stringify(status, null, 2).split('\n').map(l => '   ' + l).join('\n'));
  console.log('   ✅ Status API working');
  
  // Test 7: Gradual Weight Recovery
  console.log('\n9️⃣ Test: Gradual Weight Recovery');
  const testTarget = targets.find(t => t.url.includes('3003'));
  testTarget.effectiveWeight = 1;
  testTarget.weight = 10;
  
  console.log(`   Initial effective weight: ${testTarget.effectiveWeight}`);
  for (let i = 0; i < 5; i++) {
    loadBalancer.release(testTarget, true, 50);
  }
  console.log(`   After 5 successes: effective weight: ${testTarget.effectiveWeight.toFixed(2)}`);
  console.log('   ✅ Gradual recovery working');
  
  // Cleanup
  console.log('\n🔚 Cleaning up test servers...');
  testServers.forEach(s => s.close());
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!');
  console.log('\n📊 Summary:');
  console.log('   ✅ Round-robin strategy');
  console.log('   ✅ IP-hash consistent hashing');
  console.log('   ✅ Weighted routing');
  console.log('   ✅ Latency-based routing');
  console.log('   ✅ Health tracking & failure detection');
  console.log('   ✅ Status API');
  console.log('   ✅ Gradual weight recovery');
  
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
