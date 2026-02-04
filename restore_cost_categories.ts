import { PrismaClient } from '@prisma/client';
import { prisma } from './src/lib/prisma';

async function restoreCostCategories() {
    console.log('🔄 Checking Cost Categories...');

    const count = await prisma.costCategory.count();

    if (count > 0) {
        console.log(`✅ Found ${count} categories. No action needed.`);
        const categories = await prisma.costCategory.findMany();
        console.table(categories);
        return;
    }

    console.log('⚠️ No categories found. Seeding defaults...');

    const defaults = [
        { name: 'Sueldos', type: 'FIXED', description: 'Salarios del personal fijo' },
        { name: 'Alquiler', type: 'FIXED', description: 'Alquiler del local' },
        { name: 'Servicios Básicos', type: 'FIXED', description: 'Electricidad, Agua, Internet' },
        { name: 'Insumos Médicos', type: 'VARIABLE', description: 'Materiales descartables, jeringas, etc.' },
        { name: 'Mantenimiento', type: 'VARIABLE', description: 'Reparaciones y limpieza' },
        { name: 'Marketing', type: 'VARIABLE', description: 'Publicidad y redes sociales' },
        { name: 'Impuestos', type: 'FIXED', description: 'Obligaciones tributarias' },
        { name: 'Otros', type: 'VARIABLE', description: 'Gastos diversos' }
    ];

    for (const cat of defaults) {
        // Find by name to avoid duplicates if re-running partially
        const exists = await prisma.costCategory.findFirst({ where: { name: cat.name } });
        if (!exists) {
            await prisma.costCategory.create({
                data: {
                    name: cat.name,
                    type: cat.type as any, // Cast to match enum if needed
                    description: cat.description
                }
            });
            console.log(`   + Created: ${cat.name}`);
        }
    }

    console.log('✅ Cost Categories restored successfully!');
}

restoreCostCategories()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
