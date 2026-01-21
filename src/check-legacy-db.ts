import 'dotenv/config';
import { Pool } from 'pg';

const run = async () => {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

    try {
        console.log('--- Checking public.personas ---');
        try {
            const res = await pool.query("SELECT * FROM public.personas WHERE rol_id = 3 LIMIT 1");
            if (res.rows.length > 0) {
                console.log('Sample Row:', res.rows[0]);
            } else {
                console.log('Table exists but no patients (rol_id=3) found.');
            }
        } catch (e: any) {
            console.error('Error querying public.personas:', e.message);
        }

        console.log('\n--- Checking public.seguros ---');
        try {
            const res = await pool.query("SELECT * FROM public.seguros LIMIT 1");
            if (res.rows.length > 0) {
                console.log('Sample Row:', res.rows[0]);
            } else {
                console.log('Table exists but is empty.');
            }
        } catch (e: any) {
            console.error('Error querying public.seguros:', e.message);
        }

    } catch (err) {
        console.error('General Error:', err);
    } finally {
        await pool.end();
    }
};

run();
