import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Inspecting data for Jessica Jara...');

    const pro = await prisma.professional.findFirst({
        where: {
            lastName: { contains: 'Jara', mode: 'insensitive' },
            firstName: { contains: 'Jessica', mode: 'insensitive' }
        },
        include: { user: true }
    });

    if (!pro) {
        console.log('Professional not found!');
        return;
    }

    console.log('Professional Found:');
    console.log(`- ID: ${pro.id}`);
    console.log(`- User ID: ${pro.userId}`);
    console.log(`- Name: ${pro.firstName} ${pro.lastName}`);

    const MIGRATION_ID_USED = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
    console.log(`\nMigration Hardcoded ID: ${MIGRATION_ID_USED}`);

    console.log(`\nChecking Match:`);
    console.log(`- Matches Professional ID? ${pro.id === MIGRATION_ID_USED}`);
    console.log(`- Matches User ID? ${pro.userId === MIGRATION_ID_USED}`);

    // Check Appointments
    console.log('\nChecking Appointments counting (All time):');

    const countByUserId = await prisma.appointment.count({
        where: { doctorId: pro.userId }
    });
    console.log(`- Appointments linked to User ID (${pro.userId}): ${countByUserId}`);

    const countByProfId = await prisma.appointment.count({
        where: { doctorId: pro.id }
    });
    console.log(`- Appointments linked to Professional ID (${pro.id}): ${countByProfId}`);

    if (MIGRATION_ID_USED !== pro.userId && MIGRATION_ID_USED !== pro.id) {
        const countByMigrationId = await prisma.appointment.count({
            where: { doctorId: MIGRATION_ID_USED }
        });
        console.log(`- Appointments linked to Migration ID (${MIGRATION_ID_USED}): ${countByMigrationId}`);

        // Check if a user exists with migration ID
        const userExists = await prisma.user.findUnique({ where: { id: MIGRATION_ID_USED } });
        console.log(`- Does User exist with Migration ID? ${!!userExists}`);
    } else {
        // Double check specific date Feb 17 2026
        const targetDate = new Date('2026-02-17T00:00:00.000Z'); // UTC start
        const targetDateEnd = new Date('2026-02-17T23:59:59.999Z');

        const appointmentsOnDate = await prisma.appointment.findMany({
            where: {
                doctorId: pro.userId,
                date: {
                    gte: targetDate,
                    lte: targetDateEnd
                }
            },
            select: { id: true, date: true, duration: true }
        });

        console.log(`\nAppointments on Feb 17 2026 (User ID): ${appointmentsOnDate.length}`);
        appointmentsOnDate.forEach(a => console.log(`  - ${a.date.toISOString()} (${a.duration} min)`));
    }
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
