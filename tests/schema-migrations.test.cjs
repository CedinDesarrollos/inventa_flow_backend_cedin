const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const root = path.resolve(__dirname, '..');
const baseline = '20261011000000_baseline';
const sql = require('node:fs').readdirSync(path.join(root, 'prisma/migrations')).sort().filter(name => require('node:fs').existsSync(path.join(root, 'prisma/migrations', name, 'migration.sql'))).map(name => readFileSync(path.join(root, 'prisma/migrations', name, 'migration.sql'), 'utf8')).join('\n');

// Opt in explicitly; these tests create and remove their own local databases.
test('migration deployment and existing-schema baseline preserve data and reject drift', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const source = new URL(process.env.TEST_DATABASE_URL);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Use a disposable local PostgreSQL instance');
    const admin = new Pool({ connectionString: source.toString() });
    const databases = [];
    async function database(suffix) {
        const name = `inventa_schema_${process.pid}_${suffix}`;
        await admin.query(`CREATE DATABASE "${name}"`);
        databases.push(name);
        const url = new URL(source); url.pathname = '/' + name;
        return { url: url.toString(), pool: new Pool({ connectionString: url.toString() }) };
    }
    function execute(url, args) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, args, {
                cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '', stderr = '';
            const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
            child.stdout.on('data', data => stdout += data);
            child.stderr.on('data', data => stderr += data);
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
        });
    }
    function run(url, action) {
        return execute(url, ['scripts/manage-schema.cjs', action]);
    }
    function ok(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
    const pools = [];
    try {
        const fresh = await database('fresh'); pools.push(fresh.pool);
        ok(await run(fresh.url, 'deploy'));
        ok(await run(fresh.url, 'deploy'));
        const applied = await fresh.pool.query('SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL');
        assert.equal(applied.rows[0].count, 2);
        const diff = await execute(fresh.url, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
        ok(diff);

        const existing = await database('existing'); pools.push(existing.pool);
        await existing.pool.query(sql);
        await existing.pool.query(`INSERT INTO inventa_clinical_app.users (id, email, password_hash, full_name, updated_at)
            VALUES ('sentinel', 'sentinel@example.invalid', 'not-a-real-password', 'Synthetic test', NOW())`);
        const blocked = await run(existing.url, 'deploy');
        assert.equal(blocked.status, 1);
        assert.match(blocked.stderr, /Existing schema without verified baseline/);
        assert.equal((await existing.pool.query("SELECT to_regclass('public._prisma_migrations') AS name")).rows[0].name, null);

        await existing.pool.query('ALTER TABLE inventa_clinical_app.users ADD COLUMN unexpected_test_column TEXT');
        const drift = await run(existing.url, 'baseline');
        assert.equal(drift.status, 1);
        assert.match(drift.stderr, /Baseline refused/);
        assert.equal((await existing.pool.query("SELECT to_regclass('public._prisma_migrations') AS name")).rows[0].name, null);
        await existing.pool.query('ALTER TABLE inventa_clinical_app.users DROP COLUMN unexpected_test_column');
        ok(await run(existing.url, 'baseline'));
        ok(await run(existing.url, 'deploy'));
        assert.equal((await existing.pool.query("SELECT full_name FROM inventa_clinical_app.users WHERE id = 'sentinel'")).rows[0].full_name, 'Synthetic test');
        assert.equal((await existing.pool.query('SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count, 2);
        const duplicate = await run(existing.url, 'baseline');
        assert.equal(duplicate.status, 1);
        assert.match(duplicate.stderr, /Baseline already recorded/);
    } finally {
        await Promise.all(pools.map(pool => pool.end()));
        for (const name of databases) await admin.query(`DROP DATABASE "${name}"`);
        await admin.end();
    }
});
