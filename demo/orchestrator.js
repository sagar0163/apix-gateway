import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MOCK SERVICES CONFIG ---
const MOCK_SERVICES = [
    { name: 'Users Service', port: 3010, color: 'cyan' },
    { name: 'Orders Service', port: 3011, color: 'magenta' },
    { name: 'Products Service', port: 3012, color: 'yellow' }
];

// --- APP STATE ---
const failures = new Set();
const delays = new Map();

// --- START MOCK SERVICES ---
MOCK_SERVICES.forEach(service => {
    const app = express();
    
    app.use((req, res, next) => {
        if (failures.has(service.port)) {
            return res.status(500).json({ error: 'Service Unavailable', chaos: true });
        }
        
        const delay = delays.get(service.port) || 0;
        if (delay > 0) {
            setTimeout(next, delay);
        } else {
            next();
        }
    });

    app.get('/health', (req, res) => res.end('OK'));
    
    app.get('/*', (req, res) => {
        res.json({
            service: service.name,
            port: service.port,
            path: req.path,
            timestamp: new Date().toISOString(),
            status: 'success'
        });
    });

    app.listen(service.port, () => {
        console.log(chalk[service.color](`[MOCK] ${service.name} listening on port ${service.port}`));
    });
});

// --- CHAOS CONTROL API ---
const chaos = express();
chaos.use(express.json());

// Enable CORS for dashboard at 3000
chaos.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

chaos.get('/status', (req, res) => {
    res.json({
        failures: Array.from(failures),
        delays: Object.fromEntries(delays)
    });
});

chaos.post('/toggle/:port', (req, res) => {
    const port = parseInt(req.params.port);
    if (failures.has(port)) {
        failures.delete(port);
    } else {
        failures.add(port);
    }
    res.json({ failures: Array.from(failures) });
});

chaos.post('/delay/:port', (req, res) => {
    const port = parseInt(req.params.port);
    const { ms } = req.body;
    delays.set(port, ms);
    res.json({ delays: Object.fromEntries(delays) });
});

chaos.listen(3099, () => {
    console.log(chalk.red.bold(`[CHAOS] Pulse Orchestrator listening on port 3099`));
});

// --- START APIX GATEWAY ---
console.log(chalk.green.bold(`\n[GATEWAY] Launching Hardened APIX Gateway on port 3000...`));

const gatewayEnv = {
    ...process.env,
    PORT: '3000',
    NODE_ENV: 'development',
    JWT_SECRET: 'demo-secret-key-32-chars-at-least-safe',
    ADMIN_PASSWORD: 'admin1234',
    REDIS_URL: '',
    API_USERS: 'http://localhost:3010',
    API_ORDERS: 'http://localhost:3011',
    API_PRODUCTS: 'http://localhost:3012',
    REQUEST_TIMEOUT: '5000'
};

const gateway = spawn('node', ['src/index.js'], {
    env: gatewayEnv,
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..')
});

gateway.on('close', (code) => {
    console.log(chalk.red(`[GATEWAY] Process exited with code ${code}`));
    process.exit(code);
});

// Handle graceful exit
process.on('SIGINT', () => {
    gateway.kill();
    process.exit();
});
