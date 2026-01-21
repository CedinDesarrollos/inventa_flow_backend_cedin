import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeLegacyTable() {
    try {
        console.log('=== LEGACY TABLE STRUCTURE ===\n');

        const columns: any = await prisma.$queryRaw`
            SELECT column_name, data_type, character_maximum_length, is_nullable 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'reservas_consultas' 
            ORDER BY ordinal_position
        `;

        console.log('Columns:');
        columns.forEach((col: any) => {
            console.log(`  - ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });

        console.log('\n=== SAMPLE DATA (3 records from 2026-01-01) ===\n');

        const sampleData: any = await prisma.$queryRaw`
            SELECT * FROM public.reservas_consultas 
            WHERE fecha_inicio > '2026-01-01' 
            AND estado_reserva = 'ACCEPTED' 
            LIMIT 3
        `;

        console.log(JSON.stringify(sampleData, null, 2));

        console.log('\n=== RECORD COUNT ===\n');
        const count: any = await prisma.$queryRaw`
            SELECT COUNT(*) as total 
            FROM public.reservas_consultas 
            WHERE fecha_inicio > '2026-01-01' 
            AND estado_reserva = 'ACCEPTED'
        `;

        console.log(`Total records to migrate: ${count[0].total}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

analyzeLegacyTable();
