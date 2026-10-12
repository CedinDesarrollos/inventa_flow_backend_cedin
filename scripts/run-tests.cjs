const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
// Exercise development assertions even when the build host sets NODE_ENV=production.
const files = readdirSync('tests').filter(name => name.endsWith('.test.cjs')).sort().map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
