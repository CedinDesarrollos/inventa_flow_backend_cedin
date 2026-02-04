import { prisma } from './src/lib/prisma';

const categories = [
    { name: 'Insumos Médicos', type: 'VARIABLE', description: 'Gasto en materiales e insumos' },
    { name: 'Alquiler', type: 'FIXED', description: 'Pago de alquiler del local' },
    { name: 'Servicios Básicos', type: 'FIXED', description: 'Luz, Agua, Internet' },
    { name: 'Salarios', type: 'FIXED', description: 'Pago de nómina' },
    { name: 'Marketing', type: 'VARIABLE', description: 'Publicidad y redes sociales' },
    { name: 'Mantenimiento', type: 'EVENT', description: 'Reparaciones y limpieza' },
    { name: 'Otros', type: 'EVENT', description: 'Gastos varios' }
];

async function main() {
    console.log('Seeding categories...');
    for (const cat of categories) {
        await prisma.costCategory.upsert({
            where: { name: cat.name },
            update: {},
            create: {
                name: cat.name,
                type: cat.type as any,
                description: cat.description,
                isActive: true
            }
        });
    }
    console.log('Categories seeded.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
