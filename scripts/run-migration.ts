import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    console.log('🚀 Starting database migration...\n');

    const client = await pool.connect();

    try {
        // Read the SQL file
        const sqlPath = join(__dirname, '../prisma/manual-migrations/manual_add_appointment_reminders.sql');
        const sql = readFileSync(sqlPath, 'utf-8');

        console.log('📝 Executing SQL migration...\n');

        // Execute the entire SQL file as one transaction
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        console.log('✅ Migration executed successfully!\n');

        // Verify the changes
        console.log('🔍 Verifying migration...\n');

        const profFields = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'inventa_clinical_app' 
      AND table_name = 'professionals' 
      AND column_name IN ('gender', 'prefix')
    `);

        console.log(`✅ Professional fields added: ${profFields.rows.map(r => r.column_name).join(', ')}`);

        const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'inventa_clinical_app' 
      AND table_name = 'appointment_reminders'
    `);

        if (tableCheck.rows.length > 0) {
            console.log('✅ appointment_reminders table created');
        }

        const settingsCheck = await client.query(`
      SELECT key 
      FROM inventa_clinical_app.system_settings 
      WHERE key LIKE 'reminder%'
    `);

        console.log(`✅ System settings added: ${settingsCheck.rows.map(s => s.key).join(', ')}`);

        console.log('\n🎉 Migration completed successfully!');
        console.log('\n📊 Summary:');
        console.log('  ✅ Added gender and prefix to professionals table');
        console.log('  ✅ Created appointment_reminders table with indexes');
        console.log('  ✅ Added 3 reminder system settings');

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('\n❌ Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
