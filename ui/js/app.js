// APIX Gateway Dashboard JavaScript

const API_BASE = window.location.port ? `${window.location.protocol}//${window.location.host}` : '';
let currentPage = 'dashboard';
let plugins = {};
let stats = {};
let apiKeys = [];
let circuits = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupNavigation();
});

// Authentication
function checkAuth() {
  const token = localStorage.getItem('apix_token');
  if (token) {
    showDashboard();
    loadAllData();
  } else {
    showLogin();
  }
}

function showLogin() {
  document.querySelector('.login-container').style.display = 'flex';
  document.querySelector('.dashboard').classList.remove('active');
}

function showDashboard() {
  document.querySelector('.login-container').style.display = 'none';
  document.querySelector('.dashboard').classList.add('active');
}

async function login(username, password) {
  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (!res.ok) throw new Error('Login failed');
    
    const data = await res.json();
    localStorage.setItem('apix_token', data.token);
    showDashboard();
    loadAllData();
  } catch (err) {
    alert('Login failed: ' + err.message);
  }
}

function logout() {
  localStorage.removeItem('apix_token');
  showLogin();
}

// Navigation
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
    });
  });
  
  // Login form
  document.getElementById('loginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    login(username, password);
  });
}

function navigateTo(page) {
  currentPage = page;
  
  // Update nav
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
  
  // Show page
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = p.id === page ? 'block' : 'none';
  });
  
  // Load data if needed
  if (page === 'dashboard') loadStats();
  if (page === 'plugins') loadPlugins();
  if (page === 'keys') loadApiKeys();
  if (page === 'circuits') loadCircuits();
}

// Data Loading
async function loadAllData() {
  await Promise.all([
    loadStats(),
    loadPlugins()
  ]);
}

async function loadStats() {
  try {
    const res = await fetchWithAuth('/admin/stats');
    stats = await res.json();
    renderStats();
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadPlugins() {
  try {
    const res = await fetchWithAuth('/admin/plugins');
    const data = await res.json();
    plugins = data.enabled || [];
    renderPlugins();
  } catch (err) {
    console.error('Failed to load plugins:', err);
  }
}

async function loadApiKeys() {
  try {
    const res = await fetchWithAuth('/admin/keys');
    apiKeys = await res.json();
    renderApiKeys();
  } catch (err) {
    console.error('Failed to load keys:', err);
  }
}

async function loadCircuits() {
  try {
    const res = await fetchWithAuth('/admin/circuits');
    circuits = await res.json();
    renderCircuits();
  } catch (err) {
    console.error('Failed to load circuits:', err);
  }
}

async function togglePlugin(name, enabled) {
  try {
    const endpoint = enabled ? 'enable' : 'disable';
    await fetchWithAuth(`/admin/plugins/${name}/${endpoint}`, {
      method: 'POST'
    });
    loadPlugins();
  } catch (err) {
    alert('Failed to toggle plugin');
  }
}

async function createApiKey(name, rateLimit) {
  try {
    await fetchWithAuth('/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rateLimit })
    });
    loadApiKeys();
  } catch (err) {
    alert('Failed to create key');
  }
}

async function deleteApiKey(key) {
  if (!confirm('Delete this API key?')) return;
  try {
    await fetchWithAuth(`/admin/keys/${key}`, { method: 'DELETE' });
    loadApiKeys();
  } catch (err) {
    alert('Failed to delete key');
  }
}

async function resetCircuit(service) {
  if (!confirm(`Reset circuit for ${service}?`)) return;
  try {
    await fetchWithAuth(`/admin/circuits/${service}/reset`, { method: 'POST' });
    loadCircuits();
  } catch (err) {
    alert('Failed to reset circuit');
  }
}

// Rendering
function renderStats() {
  const uptime = formatUptime(stats.uptime);
  const memory = formatBytes(stats.memory?.heapUsed || 0);
  
  document.getElementById('statUptime').textContent = uptime;
  document.getElementById('statMemory').textContent = memory;
  document.getElementById('statRequests').textContent = stats.requests?.total || '0';
  document.getElementById('statErrors').textContent = stats.requests?.errors || '0';
}

function renderPlugins() {
  const container = document.getElementById('pluginsGrid');
  const allPlugins = [
    { name: 'rate-limiter', desc: 'Request rate limiting', enabled: plugins.some(p => p.name === 'rate-limiter') },
    { name: 'jwt-auth', desc: 'JWT authentication', enabled: plugins.some(p => p.name === 'jwt-auth') },
    { name: 'api-key', desc: 'API Key authentication', enabled: plugins.some(p => p.name === 'api-key') },
    { name: 'basic-auth', desc: 'HTTP Basic auth', enabled: plugins.some(p => p.name === 'basic-auth') },
    { name: 'hmac-auth', desc: 'HMAC signature verification', enabled: plugins.some(p => p.name === 'hmac-auth') },
    { name: 'oauth2', desc: 'OAuth2 authentication', enabled: plugins.some(p => p.name === 'oauth2') },
    { name: 'keycloak', desc: 'Keycloak/OIDC', enabled: plugins.some(p => p.name === 'keycloak') },
    { name: 'cors', desc: 'CORS headers', enabled: plugins.some(p => p.name === 'cors') },
    { name: 'metrics', desc: 'Request metrics', enabled: plugins.some(p => p.name === 'metrics') },
    { name: 'cache', desc: 'Response caching', enabled: plugins.some(p => p.name === 'cache') },
    { name: 'circuit-breaker', desc: 'Circuit breaker', enabled: plugins.some(p => p.name === 'circuit-breaker') },
    { name: 'load-balancer', desc: 'Load balancing', enabled: plugins.some(p => p.name === 'load-balancer') },
    { name: 'websocket', desc: 'WebSocket proxy', enabled: plugins.some(p => p.name === 'websocket') },
    { name: 'quota', desc: 'Request quota', enabled: plugins.some(p => p.name === 'quota') },
    { name: 'retry', desc: 'Auto retry', enabled: plugins.some(p => p.name === 'retry') },
    { name: 'distributed-trace', desc: 'Distributed tracing', enabled: plugins.some(p => p.name === 'distributed-trace') },
    { name: 'graphql-protection', desc: 'GraphQL protection', enabled: plugins.some(p => p.name === 'graphql-protection') },
    { name: 'bot-detection', desc: 'Bot detection', enabled: plugins.some(p => p.name === 'bot-detection') },
    { name: 'ip-whitelist', desc: 'IP filtering', enabled: plugins.some(p => p.name === 'ip-whitelist') },
  ];
  
  container.innerHTML = allPlugins.map(p => `
    <div class="plugin-card fade-in">
      <div class="plugin-header">
        <div>
          <div class="plugin-name">${p.name}</div>
          <div class="plugin-desc">${p.desc}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${p.enabled ? 'checked' : ''} 
            onchange="togglePlugin('${p.name}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="plugin-meta">
        <span class="status-badge ${p.enabled ? 'active' : 'inactive'}">
          ${p.enabled ? '● Active' : '○ Inactive'}
        </span>
      </div>
    </div>
  `).join('');
}

function renderApiKeys() {
  const container = document.getElementById('apiKeysTable');
  if (!apiKeys.length) {
    container.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No API keys found</td></tr>';
    return;
  }
  
  container.innerHTML = apiKeys.map(k => `
    <tr>
      <td>${k.name || 'Unnamed'}</td>
      <td><code>${k.key}</code></td>
      <td>${k.rateLimit || 'N/A'}</td>
      <td>${k.createdAt ? new Date(k.createdAt).toLocaleDateString() : 'N/A'}</td>
      <td>
        <button class="btn" style="padding:0.5rem;background:var(--danger)" 
          onclick="deleteApiKey('${k.key}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderCircuits() {
  const container = document.getElementById('circuitsTable');
  const services = Object.entries(circuits);
  
  if (!services.length) {
    container.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No circuits active</td></tr>';
    return;
  }
  
  container.innerHTML = services.map(([name, data]) => `
    <tr>
      <td>${name}</td>
      <td><span class="status-badge ${data.state === 'closed' ? 'active' : data.state === 'open' ? 'error' : 'warning'}">${data.state}</span></td>
      <td>${data.failures}</td>
      <td>${data.successes}</td>
      <td>
        <button class="btn" style="padding:0.5rem;background:var(--warning)" 
          onclick="resetCircuit('${name}')">Reset</button>
      </td>
    </tr>
  `).join('');
}

// Utilities
async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('apix_token');
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });
  
  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  
  return res;
}

function formatUptime(seconds) {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Auto-refresh stats
setInterval(() => {
  if (document.querySelector('.dashboard.active')) {
    loadStats();
  }
}, 5000);
