// Read-only legacy inventory: counts only, no patient information or data repair.
require('dotenv/config');
const { Pool } = require('pg');
(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
    try {
        const result = await pool.query(`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE end_date IS NULL)::int AS missing_end,
            count(*) FILTER (WHERE end_date IS NOT NULL AND end_date <> date + duration * interval '1 minute')::int AS inconsistent_end,
            count(*) FILTER (WHERE duration <= 0)::int AS invalid_duration
            FROM inventa_clinical_app.appointments`);
        console.log(JSON.stringify(result.rows[0], null, 2));
    } finally { await pool.end(); }
})().catch(error => { console.error('Interval inspection failed:', error.code || error.message); process.exitCode = 1; });
