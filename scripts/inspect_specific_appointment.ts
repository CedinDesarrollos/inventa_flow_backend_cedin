import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
    const userId = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
    const targetDate = new Date('2026-02-17T12:30:00.000Z');

    console.log(`Inspecting appointment at ${targetDate.toISOString()} for User ${userId}...`);

    const appt = await prisma.appointment.findFirst({
        where: {
            doctorId: userId,
            date: targetDate
        },
        include: {
            patient: true
        }
    });

    if (appt) {
        console.log('FOUND APPOINTMENT:');
        console.log(`ID: ${appt.id}`);
        console.log(`Patient: ${appt.patient?.firstName} ${appt.patient?.lastName}`);
        console.log(`Status: ${appt.status}`);
        console.log(`Legacy Type: ${appt.legacy_tipoReserva}`);
        console.log(`Duration: ${appt.duration}`);
        console.log(`Branch ID: ${appt.branchId}`);
    } else {
        console.log('No appointment found at that exact time.');
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
