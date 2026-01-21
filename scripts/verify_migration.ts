import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function verifyMigration() {
    console.log('='.repeat(80));
    console.log('POST-MIGRATION VERIFICATION');
    console.log('='.repeat(80));
    console.log('');

    // 1. Count migrated appointments
    const count = await prisma.appointment.count({
        where: { externalId: { not: null } }
    });
    console.log(`✓ Total migrated appointments: ${count}`);
    console.log('  Expected: 416');
    console.log(`  Status: ${count === 416 ? '✅ PASS' : '❌ FAIL'}`);
    console.log('');

    // 2. Date range
    const dateRange = await prisma.appointment.aggregate({
        where: { externalId: { not: null } },
        _min: { date: true },
        _max: { date: true }
    });
    console.log(`✓ Date range:`);
    console.log(`  First appointment: ${dateRange._min.date?.toISOString().split('T')[0]}`);
    console.log(`  Last appointment: ${dateRange._max.date?.toISOString().split('T')[0]}`);
    console.log('');

    // 3. Distribution by professional
    const byProfessional = await prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { externalId: { not: null } },
        _count: true
    });

    console.log(`✓ Distribution by professional:`);
    for (const group of byProfessional) {
        const doctor = await prisma.user.findUnique({
            where: { id: group.doctorId! },
            select: { fullName: true }
        });
        console.log(`  ${doctor?.fullName}: ${group._count} appointments`);
    }
    console.log('');

    // 4. Sample records
    const sample = await prisma.appointment.findMany({
        where: { externalId: { not: null } },
        take: 5,
        include: {
            patient: { select: { firstName: true, lastName: true, identifier: true } },
            doctor: { select: { fullName: true } }
        },
        orderBy: { date: 'asc' }
    });

    console.log(`✓ Sample records (first 5):`);
    sample.forEach((apt, i) => {
        console.log(`  ${i + 1}. ${apt.patient.firstName} ${apt.patient.lastName} (${apt.patient.identifier})`);
        console.log(`     Date: ${apt.date.toISOString()}`);
        console.log(`     Doctor: ${apt.doctor?.fullName}`);
        console.log(`     Duration: ${apt.duration} min`);
        console.log(`     External ID: ${apt.externalId}`);
        console.log('');
    });

    await prisma.$disconnect();
}

verifyMigration();
