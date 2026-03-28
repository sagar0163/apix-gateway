import http from 'http';
import request from 'supertest';
import app from '../../src/index.js';
import { pluginManager } from '../../src/plugins/index.js';
import config from '../../src/utils/config.js';
import chalk from 'chalk';

const MOCK_PORT = 3020;

// --- MOCK UPSTREAM ---
let activeMode = 'normal';
const mockUpstream = http.createServer((req, res) => {
    switch(activeMode) {
        case 'slow':
            setTimeout(() => {
                res.writeHead(200);
                res.end('Delayed OK');
            }, 3000);
            break;
        case 'flapping':
            if (Math.random() > 0.5) {
                res.writeHead(200);
                res.end('OK');
            } else {
                res.writeHead(500);
                res.end('Chaos Error');
            }
            break;
        case 'captcha':
            res.writeHead(200);
            res.end('Solve Captcha to Proceed');
            break;
        case 'normal':
        default:
            res.writeHead(200);
            res.end('OK');
    }
});

const runTest = async (name, path, iterations = 10) => {
    const lb = pluginManager.getPlugin('load-balancer');
    if (lb) lb.resetAll();

    console.log(chalk.blue(`\n[SCENARIO] ${name}`));
    let success = 0;
    let failure = 0;
    let start = Date.now();

    for (let i = 0; i < iterations; i++) {
        try {
            const res = await request(app)
                .get(path)
                .set('x-upstream-timeout', '1000'); // Short timeout for test
            
            if (res.status === 200 && !res.text.toLowerCase().includes('captcha')) {
                success++;
            } else {
                failure++;
            }
        } catch (e) {
            failure++;
        }
    }
    
    return {
        name,
        successRate: Math.round((success / iterations) * 100),
        avgLatency: Math.round((Date.now() - start) / iterations)
    };
};

async function main() {
    await new Promise(resolve => mockUpstream.listen(MOCK_PORT, resolve));
    
    // Setup Gateway for Test
    config.apis['/api/chaos'] = `http://localhost:${MOCK_PORT}`;
    
    pluginManager.disable('jwt-auth');
    pluginManager.disable('rate-limiter');
    
    pluginManager.enable('load-balancer', {
        enabled: true,
        targets: [`http://localhost:${MOCK_PORT}`],
        trustedSuccessPatterns: { enabled: true, patterns: ['captcha'] }
    });
    
    pluginManager.enable('circuit-breaker', {
        enabled: true,
        failureThreshold: 3,
        timeout: 5000
    });

    const reports = [];

    activeMode = 'normal';
    reports.push(await runTest('Stable Load', '/api/chaos/test'));

    activeMode = 'flapping';
    reports.push(await runTest('Upstream Flapping (50% Loss)', '/api/chaos/test'));

    activeMode = 'captcha';
    reports.push(await runTest('Soft Failure (CAPTCHAs)', '/api/chaos/test'));

    activeMode = 'slow';
    reports.push(await runTest('Black Hole (Stalling)', '/api/chaos/test'));

    console.table(reports);
    mockUpstream.close();
}

main().catch(console.error);
