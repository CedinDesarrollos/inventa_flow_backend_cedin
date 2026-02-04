import { prisma } from '../src/lib/prisma';

const DEFAULT_CATEGORIES = [
    { name: 'Recursos Humanos', type: 'FIXED', description: 'Salarios, bonos, cargas sociales' },
    { name: 'Servicios Básicos', type: 'FIXED', description: 'Agua, luz, internet, teléfono' },
    { name: 'Servicios Profesionales', type: 'FIXED', description: 'Contabilidad, legal, limpieza' },
    { name: 'Mantenimiento', type: 'EVENT', description: 'Plomería, electricidad, equipamiento' },
    { name: 'Materiales de Consumo', type: 'VARIABLE', description: 'Papel, tinta, alcohol, algodón' },
    { name: 'Insumos Médicos', type: 'VARIABLE', description: 'Guantes, jeringas, gasas' },
    { name: 'Otros', type: 'VARIABLE', description: 'Gastos varios' }
];

async function seedCostCategories() {
    console.log('🌱 Seeding cost categories...');

    for (const cat of DEFAULT_CATEGORIES) {
        await prisma.costCategory.upsert({
            where: { name: cat.name },
            update: {},
            create: cat
        });
        console.log(`  ✓ ${cat.name}`);
    }

    console.log('✅ Cost categories seeded successfully');
}

seedCostCategories()
    .catch((e) => {
        console.error('❌ Error seeding cost categories:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
