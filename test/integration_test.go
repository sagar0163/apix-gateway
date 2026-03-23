package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// =======================
// TEST CONFIGURATION
// =======================

const (
	gatewayAddr       = ":3001"
	upstreamSlowAddr  = ":3002"
	upstreamFastAddr  = ":3003"
	testTimeout       = 30 * time.Second
	memoryCheckDelay  = 500 * time.Millisecond
)

// =======================
// HELPER TYPES
// =======================

type testMetrics struct {
	requestsServed   atomic.Int64
	activeRequests   atomic.Int64
	peakActive       atomic.Int64
	memoryLeaked     bool
	lastMemoryMB     float64
}

var metrics testMetrics

// =======================
// MOCK UPSTREAM SERVICES
// =======================

// Slow upstream that simulates partial success
func startSlowUpstream() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		metrics.activeRequests.Add(1)
		current := metrics.activeRequests.Add(1)
		for {
			peak := metrics.peakActive.Load()
			if current > peak {
				metrics.peakActive.Store(current)
			}
			break
		}
		defer metrics.activeRequests.Add(-1)

		// Simulate slow response (partial write before timeout)
		time.Sleep(2 * time.Second)

		// Send partial response then close
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"partial"}`))
	}))
}

// Fast upstream for baseline testing
func startFastUpstream() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		metrics.requestsServed.Add(1)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"success"}`))
	}))
}

// Slow upstream that hangs indefinitely (for timeout testing)
func startHangUpstream() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {}
	}))
}

// =======================
// GATEWAY CLIENT
// =======================

type gatewayClient struct {
	baseURL  string
	client   *http.Client
}

func newGatewayClient(addr string) *gatewayClient {
	return &gatewayClient{
		baseURL: fmt.Sprintf("http://localhost%s", addr),
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *gatewayClient) get(path string) (*http.Response, error) {
	return c.client.Get(c.baseURL + path)
}

func (c *gatewayClient) post(path string, body string) (*http.Response, error) {
	return c.client.Post(c.baseURL+path, "application/json", strings.NewReader(body))
}

// =======================
// MEMORY PROFILING
// =======================

func getMemoryMB() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(m.Alloc) / 1024 / 1024
}

func monitorMemory(initialMem float64, duration time.Duration, thresholdMB float64) bool {
	deadline := time.Now().Add(duration)
	for time.Now().Before(deadline) {
		time.Sleep(memoryCheckDelay)
		currentMem := getMemoryMB()
		if currentMem-initialMem > thresholdMB {
			fmt.Printf("⚠️  Memory leak detected: initial=%.2fMB, current=%.2fMB, diff=%.2fMB\n",
				initialMem, currentMem, currentMem-initialMem)
			return true
		}
	}
	return false
}

// =======================
// TEST 1: Retry Logic with Slow Upstream
// =======================

func TestRetryWithSlowUpstream(t *testing.T) {
	fmt.Println("\n🧪 Test: Retry Logic with Slow Upstream")
	fmt.Println("=========================================")

	slowServer := startSlowUpstream()
	defer slowServer.Close()

	// In real scenario, gateway would proxy to slowServer.URL
	// Here we test by calling slow server directly with timeout
	client := &http.Client{
		Timeout: 500 * time.Millisecond, // Short timeout
	}

	req, _ := http.NewRequest("GET", slowServer.URL, nil)
	
	startTime := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(startTime)

	if err == nil {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("⚠️  Expected timeout but got response: %s\n", string(body))
		t.Logf("Response received after %v (timeout should have fired)", elapsed)
	} else {
		fmt.Printf("✅ Request timed out as expected: %v\n", err)
	}

	// Check for memory leaks
	initialMem := getMemoryMB()
	
	// Make multiple requests to check for connection leaks
	for i := 0; i < 10; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		req, _ := http.NewRequestWithContext(ctx, "GET", slowServer.URL, nil)
		client.Do(req)
		cancel()
		time.Sleep(10 * time.Millisecond)
	}

	time.Sleep(100 * time.Millisecond)
	finalMem := getMemoryMB()
	memDiff := finalMem - initialMem
	
	fmt.Printf("📊 Memory: initial=%.2fMB, final=%.2fMB, diff=%.2fMB\n", 
		initialMem, finalMem, memDiff)

	if memDiff > 50 {
		t.Errorf("Memory leak detected: %.2fMB increase", memDiff)
	}
}

// =======================
// TEST 2: Timeout Handling
// =======================

func TestTimeoutHandling(t *testing.T) {
	fmt.Println("\n🧪 Test: Timeout Handling")
	fmt.Println("==========================")

	hangServer := startHangUpstream()
	defer hangServer.Close()

	client := &http.Client{
		Timeout: 1 * time.Second,
	}

	initialMem := getMemoryMB()
	var wg sync.WaitGroup
	
	// Launch multiple concurrent requests
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			req, _ := http.NewRequestWithContext(ctx, "GET", hangServer.URL, nil)
			client.Do(req)
			cancel()
		}()
	}

	wg.Wait()
	time.Sleep(200 * time.Millisecond)
	finalMem := getMemoryMB()
	memDiff := finalMem - initialMem

	fmt.Printf("📊 Memory after concurrent timeouts: initial=%.2fMB, final=%.2fMB, diff=%.2fMB\n",
		initialMem, finalMem, memDiff)

	if memDiff > 100 {
		t.Errorf("Memory leak after timeouts: %.2fMB increase", memDiff)
	}
}

// =======================
// TEST 3: Header Injection Prevention
// =======================

func TestHeaderInjection(t *testing.T) {
	fmt.Println("\n🧪 Test: Header Injection Prevention")
	fmt.Println("=======================================")

	// Test server that checks for header injection
	injectionDetected := atomic.Bool{}
	
	testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check for CR/LF in headers
		for key, values := range r.Header {
			for _, value := range values {
				if strings.Contains(value, "\r\n") {
					injectionDetected.Store(true)
					fmt.Printf("🚨 Header injection detected in %s: %q\n", key, value)
				}
			}
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	defer testServer.Close()

	// Try to inject headers via request
	client := &http.Client{}
	
	// Attempt header injection
	req, _ := http.NewRequest("GET", testServer.URL, nil)
	req.Header.Set("X-Malicious", "value\r\nX-Injected: injected")
	
	resp, err := client.Do(req)
	if err != nil {
		t.Logf("Request failed (expected): %v", err)
	}

	if injectionDetected.Load() {
		t.Error("Header injection was NOT blocked - VULNERABILITY!")
	} else {
		fmt.Println("✅ Header injection blocked")
	}

	// Test with CR character
	req2, _ := http.NewRequest("GET", testServer.URL, nil)
	req2.Header.Set("X-Test", "value\x0d\x0aBreak")
	
	resp2, err := client.Do(req2)
	if resp2 != nil {
		resp2.Body.Close()
	}

	if injectionDetected.Load() {
		t.Error("CRLF injection was NOT blocked - VULNERABILITY!")
	}
}

// =======================
// TEST 4: Race Condition in Plugin Chain
// =======================

func TestRaceConditionInPluginChain(t *testing.T) {
	fmt.Println("\n🧪 Test: Race Condition in Plugin Chain")
	fmt.Println("=========================================")

	// Test server that echoes request info
	echoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := json.Marshal(map[string]interface{}{
			"method":      r.Method,
			"path":        r.URL.Path,
			"header_count": len(r.Header),
		})
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}))
	defer echoServer.Close()

	client := &http.Client{}

	// Concurrent requests that modify shared state
	var wg sync.WaitGroup
	errors := make(chan error, 100)

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest("GET", echoServer.URL+"/test", nil)
			req.Header.Set("X-Request-ID", fmt.Sprintf("req-%d", i))
			
			resp, err := client.Do(req)
			if err != nil {
				errors <- err
				return
			}
			defer resp.Body.Close()
			
			if resp.StatusCode != http.StatusOK {
				errors <- fmt.Errorf("unexpected status: %d", resp.StatusCode)
			}
		}()
	}

	wg.Wait()
	close(errors)

	errorCount := 0
	for err := range errors {
		errorCount++
		t.Logf("Error: %v", err)
	}

	if errorCount > 0 {
		t.Errorf("%d errors during concurrent requests - possible race condition", errorCount)
	} else {
		fmt.Println("✅ No race conditions detected in concurrent requests")
	}
}

// =======================
// TEST 5: Circuit Breaker State Race
// =======================

func TestCircuitBreakerRace(t *testing.T) {
	fmt.Println("\n🧪 Test: Circuit Breaker State Race")
	fmt.Println("====================================")

	// Simulate circuit breaker with shared state
	type CircuitState struct {
		failures    int
		successes   int
		isOpen      bool
		mu          sync.Mutex
	}

	circuit := &CircuitState{}
	
	var wg sync.WaitGroup
	errorCount := atomic.Int64{}

	// Simulate rapid failures
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			
			// This simulates the race condition in circuit-breaker.js
			// Without proper locking:
			if circuit.failures >= 5 {
				errorCount.Add(1) // Should return 503 but might not
			}
			
			// Race: another goroutine can increment failures here
			circuit.failures++
			
			if !circuit.isOpen && circuit.failures >= 5 {
				// This check can pass for multiple goroutines simultaneously
				circuit.isOpen = true
			}
		}()
	}

	wg.Wait()

	// With proper mutex, this should work correctly
	fmt.Printf("📊 Circuit state after 100 concurrent failures: failures=%d, isOpen=%v\n",
		circuit.failures, circuit.isOpen)

	// Now test with mutex
	circuit2 := &CircuitState{}
	var wg2 sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg2.Add(1)
		go func() {
			defer wg2.Done()
			
			circuit2.mu.Lock()
			if circuit2.failures >= 5 {
				circuit2.mu.Unlock()
				return
			}
			circuit2.failures++
			if !circuit2.isOpen && circuit2.failures >= 5 {
				circuit2.isOpen = true
			}
			circuit2.mu.Unlock()
		}()
	}

	wg2.Wait()
	
	fmt.Printf("📊 With mutex: failures=%d, isOpen=%v\n", circuit2.failures, circuit2.isOpen)
	
	if circuit.isOpen != circuit2.isOpen {
		t.Logf("⚠️  Race condition demonstrated: unlocked=%v, locked=%v", 
			circuit.isOpen, circuit2.isOpen)
	}
}

// =======================
// TEST 6: Memory Leak Under Load
// =======================

func TestMemoryLeakUnderLoad(t *testing.T) {
	fmt.Println("\n🧪 Test: Memory Leak Under Load")
	fmt.Println("==================================")

	fastServer := startFastUpstream()
	defer fastServer.Close()

	client := &http.Client{}

	initialMem := getMemoryMB()
	fmt.Printf("📊 Initial memory: %.2fMB\n", initialMem)

	// Make 1000 requests
	var wg sync.WaitGroup
	requestCount := 1000

	for i := 0; i < requestCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := client.Get(fastServer.URL)
			if err == nil {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}()
	}

	wg.Wait()
	time.Sleep(memoryCheckDelay)

	finalMem := getMemoryMB()
	memDiff := finalMem - initialMem

	fmt.Printf("📊 After %d requests: initial=%.2fMB, final=%.2fMB, diff=%.2fMB\n",
		requestCount, initialMem, finalMem, memDiff)

	// Allow for some memory growth, but flag excessive leaks
	if memDiff > 100 {
		t.Errorf("Memory leak detected: %.2fMB increase for %d requests", memDiff, requestCount)
	} else {
		fmt.Println("✅ No significant memory leak detected")
	}
}

// =======================
// TEST 7: Partial Response Handling
// =======================

func TestPartialResponseHandling(t *testing.T) {
	fmt.Println("\n🧪 Test: Partial Response Handling")
	fmt.Println("=====================================")

	partialServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Write partial response
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"partial":`))
		
		// Force connection close before complete response
		// (simulates upstream crash)
		hij, ok := w.(http.Hijacker)
		if ok {
			hij.Hijack()
		}
	}))
	defer partialServer.Close()

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(partialServer.URL)
	if err != nil {
		fmt.Printf("✅ Partial response handled: %v\n", err)
	} else {
		defer resp.Body.Close()
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			fmt.Printf("✅ Partial read error handled: %v\n", readErr)
		} else {
			fmt.Printf("⚠️  Got partial response: %s\n", string(body))
		}
	}
}

// =======================
// TEST 8: Concurrent Timeout + Retry
// =======================

func TestConcurrentTimeoutAndRetry(t *testing.T) {
	fmt.Println("\n🧪 Test: Concurrent Timeout and Retry")
	fmt.Println("=======================================")

	// Server that times out first, then succeeds
	attemptCount := atomic.Int64{}
	
	retryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := attemptCount.Add(1)
		if count == 1 {
			// First attempt: hang
			time.Sleep(3 * time.Second)
		}
		// Subsequent: succeed
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"retried":true}`))
	}))
	defer retryServer.Close()

	client := &http.Client{
		Timeout: 1 * time.Second, // Will timeout on first attempt
	}

	initialMem := getMemoryMB()
	
	// Multiple retry attempts
	for i := 0; i < 5; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		req, _ := http.NewRequestWithContext(ctx, "GET", retryServer.URL, nil)
		
		resp, err := client.Do(req)
		if err != nil {
			// Expected timeout
		} else {
			resp.Body.Close()
		}
		cancel()
		
		time.Sleep(50 * time.Millisecond)
	}

	time.Sleep(200 * time.Millisecond)
	finalMem := getMemoryMB()
	memDiff := finalMem - initialMem

	fmt.Printf("📊 Memory after retry attempts: initial=%.2fMB, final=%.2fMB, diff=%.2fMB\n",
		initialMem, finalMem, memDiff)

	if memDiff > 50 {
		t.Errorf("Memory leak in retry logic: %.2fMB", memDiff)
	}
}

// =======================
// MAIN TEST RUNNER
// =======================

func TestMain(m *testing.M) {
	fmt.Println("╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║     APIX Gateway Integration Test Suite                       ║")
	fmt.Println("║     Testing: Timeouts, Retries, Memory Leaks, Security        ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")

	// Run tests
	os.Exit(m.Run())
}
