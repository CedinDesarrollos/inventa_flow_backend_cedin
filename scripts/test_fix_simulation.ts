import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

// Mocks
const DATE_ISO = '2026-02-17T03:00:00.000Z';
const PROFESSIONAL_ID_INPUT = '8bb7c898-0efe-4b39-944b-6c2bbd30f2c9'; // The ID sent by frontend (Prof ID)

async function testFix() {
    console.log(`\n--- Testing Availability Fix Simulation ---`);
    console.log(`Input ID: ${PROFESSIONAL_ID_INPUT}`);

    // --- LOGIC FROM availability.controller.ts (Applied Fix) ---

    // ID Resolution
    let userId = PROFESSIONAL_ID_INPUT;
    const potentialProf = await prisma.professional.findUnique({
        where: { id: PROFESSIONAL_ID_INPUT },
        select: { userId: true }
    });

    if (potentialProf) {
        console.log(`✓ RESOLVED: Professional ID -> User ID: ${potentialProf.userId}`);
        userId = potentialProf.userId;
    } else {
        console.log(`(No resolution needed or not found)`);
    }

    const date = new Date(DATE_ISO);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // 2. Get existing appointments using RESOLVED userId
    const appointments = await prisma.appointment.findMany({
        where: {
            doctorId: userId, // <--- Key usage
            status: { not: 'CANCELLED' },
            date: {
                gte: dayStart,
                lte: dayEnd
            }
        },
        orderBy: { date: 'asc' }
    });

    console.log(`Found ${appointments.length} appointments.`);
    appointments.forEach(a => console.log(`- Appt: ${a.date.toISOString()} (Duration: ${a.duration})`));

    if (appointments.length > 0) {
        console.log(`\n✅ SUCCESS: The fix correctly found appointments using the Professional ID input.`);
    } else {
        console.log(`\n❌ FAILURE: Still found 0 appointments.`);
    }
}

testFix()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
