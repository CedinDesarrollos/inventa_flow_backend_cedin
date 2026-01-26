import { prisma } from '../src/lib/prisma';

async function inspectLegacySchema() {
    try {
        // Query to get column names of the legacy table
        const columns: any[] = await prisma.$queryRaw`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'reservas_consultas'
        `;

        console.log('Columns in reservas_consultas:');
        columns.forEach(col => console.log(` - ${col.column_name} (${col.data_type})`));

    } catch (error) {
        console.error('Error inspecting schema:', error);
    } finally {
        await prisma.$disconnect();
    }
}

inspectLegacySchema();
