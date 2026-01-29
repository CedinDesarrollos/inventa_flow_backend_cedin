import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function cleanup() {
    const userId = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
    // User SQL shows 06:30:00.000.  Assuming this is UTC ISO in DB.
    const targetDate = new Date('2026-02-17T06:30:00.000Z');

    console.log(`Deleting appointment at ${targetDate.toISOString()}...`);

    const result = await prisma.appointment.deleteMany({
        where: {
            doctorId: userId,
            date: targetDate
        }
    });

    console.log(`Deleted ${result.count} appointments.`);
}

cleanup()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
