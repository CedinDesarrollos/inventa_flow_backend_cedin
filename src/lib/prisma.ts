import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
console.log('Using connection string:', connectionString);
console.log('Using options: -c search_path=inventa_clinical_app');

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    options: '-c search_path=inventa_clinical_app'
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
