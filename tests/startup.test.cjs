const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

test('npm start and restart serve health without connecting or modifying a database', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
        const listener = net.createServer();
        await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
        const port = listener.address().port;
        await new Promise(resolve => listener.close(resolve));
        const child = spawn('npm', ['start'], { cwd: path.resolve(__dirname, '..'), detached: true,
            env: { ...process.env, JWT_SECRET: 'startup-test-secret', DATABASE_URL: 'postgresql://test@127.0.0.1:1/nonexistent', PORT: String(port), NODE_OPTIONS: `--require=${path.join(__dirname, 'support/disable-cron.cjs')}` },
            stdio: ['ignore', 'pipe', 'pipe'] });
        let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
        const exited = new Promise(resolve => child.on('close', resolve));
        try {
            const deadline = Date.now() + 8000;
            let response;
            while (Date.now() < deadline && child.exitCode === null) {
                try { response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) break; } catch {}
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert.equal(response?.status, 200, logs);
            assert.equal((await response.json()).status, 'ok');
        } finally {
            if (child.exitCode === null) process.kill(-child.pid, 'SIGTERM');
            await exited;
        }
    }
});
