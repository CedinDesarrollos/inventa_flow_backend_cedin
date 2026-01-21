import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function checkSpecificAppointments() {
    console.log('Checking specific appointments mentioned by user...\n');

    // Check Zuny Olga Medina
    const zuny = await prisma.appointment.findFirst({
        where: {
            patient: {
                OR: [
                    { firstName: { contains: 'Zuny', mode: 'insensitive' } },
                    { lastName: { contains: 'Medina', mode: 'insensitive' } }
                ]
            },
            externalId: { not: null }
        },
        include: {
            patient: { select: { firstName: true, lastName: true, identifier: true } }
        }
    });

    if (zuny) {
        console.log('✓ Zuny Olga Medina:');
        console.log(`  Expected: 2026-01-26 08:20:00`);
        console.log(`  Migrated: ${zuny.date.toISOString()}`);
        console.log(`  Local time: ${zuny.date.toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}`);
        console.log('');
    }

    // Check Enzo Willian Cristaldo Ortiz
    const enzo = await prisma.appointment.findFirst({
        where: {
            patient: {
                AND: [
                    { firstName: { contains: 'Enzo', mode: 'insensitive' } },
                    {
                        OR: [
                            { lastName: { contains: 'Cristaldo', mode: 'insensitive' } },
                            { lastName: { contains: 'Ortiz', mode: 'insensitive' } }
                        ]
                    }
                ]
            },
            externalId: { not: null }
        },
        include: {
            patient: { select: { firstName: true, lastName: true, identifier: true } }
        }
    });

    if (enzo) {
        console.log('✓ Enzo Willian Cristaldo Ortiz:');
        console.log(`  Expected: 2026-01-26 08:40:00`);
        console.log(`  Migrated: ${enzo.date.toISOString()}`);
        console.log(`  Local time: ${enzo.date.toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}`);
        console.log('');
    }

    // Also check a few more from Jan 26
    const jan26 = await prisma.appointment.findMany({
        where: {
            date: {
                gte: new Date('2026-01-26T00:00:00Z'),
                lt: new Date('2026-01-27T00:00:00Z')
            },
            externalId: { not: null }
        },
        take: 5,
        include: {
            patient: { select: { firstName: true, lastName: true } }
        },
        orderBy: { date: 'asc' }
    });

    console.log(`Sample appointments from Jan 26, 2026 (${jan26.length} found):`);
    jan26.forEach((apt, i) => {
        console.log(`  ${i + 1}. ${apt.patient.firstName} ${apt.patient.lastName}`);
        console.log(`     UTC: ${apt.date.toISOString()}`);
        console.log(`     Local: ${apt.date.toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}`);
    });

    await prisma.$disconnect();
}

checkSpecificAppointments();
