require('dotenv/config');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

const baseline = '20261011000000_baseline';
const action = process.argv[2];
const prismaCli = require.resolve('prisma/build/index.js');

function prismaUrl() {
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.DATABASE_TLS === 'true') {
        url.searchParams.set('sslmode', 'require');
        url.searchParams.set('sslaccept', 'accept_invalid_certs');
    }
    return url.toString();
}

function runPrisma(args) {
    const result = spawnSync(process.execPath, [prismaCli, ...args], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: prismaUrl() },
        stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Prisma terminated with ${result.signal}`);
    return result.status;
}

async function main() {
    if (!['baseline', 'deploy'].includes(action)) throw new Error('Use baseline or deploy');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

    // Read catalog metadata only; never expose the connection URL or credentials.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, ...(process.env.DATABASE_TLS === 'true' ? { ssl: { rejectUnauthorized: false } } : {}) });
    let populated, history;
    try {
        const migrationSchema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
        const objects = await pool.query(`
            SELECT count(*)::int AS count FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'inventa_clinical_app' AND c.relname <> '_prisma_migrations'
        `);
        const types = await pool.query(`
            SELECT count(*)::int AS count FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'inventa_clinical_app' AND t.typtype = 'e'
        `);
        populated = objects.rows[0].count + types.rows[0].count > 0;
        const table = await pool.query('SELECT to_regclass($1) AS name', [`"${migrationSchema.replaceAll('"', '""')}"."_prisma_migrations"`]);
        history = false;
        if (table.rows[0].name) {
            const records = await pool.query(`SELECT EXISTS (
                SELECT 1 FROM "${migrationSchema.replaceAll('"', '""')}"."_prisma_migrations"
                WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
            ) AS applied`, [baseline]);
            history = records.rows[0].applied;
        }
    } finally {
        await pool.end();
    }

    if (action === 'baseline') {
        if (!populated) throw new Error('Empty schema: use npm run db:migrate instead');
        if (history) throw new Error('Baseline already recorded: use npm run db:status');
        const diff = runPrisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
        if (diff !== 0) throw new Error('Baseline refused: schema differs or comparison failed. Review npm run db:diff first');
        process.exitCode = runPrisma(['migrate', 'resolve', '--applied', baseline]);
        return;
    }

    if (populated && !history) {
        throw new Error('Existing schema without verified baseline: deployment refused. Read docs/database-migrations.md');
    }
    process.exitCode = runPrisma(['migrate', 'deploy']);
}

main().catch(error => {
    // pg errors can contain connection details; print a safe message for connection failures.
    const safeCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '28P01', '28000'];
    console.error(safeCodes.includes(error.code) ? `Database connection failed (${error.code})` : error.message);
    process.exitCode = 1;
});
