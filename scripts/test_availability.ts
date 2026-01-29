import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

// Mock params
const DATE_ISO = '2026-02-17T03:00:00.000Z'; // As sent by frontend (typically)
// const DATE_ISO = '2026-02-17T00:00:00.000Z'; 
const USER_ID = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
const PROF_ID = '8bb7c898-0efe-4b39-944b-6c2bbd30f2c9';
const DURATION = 30;

async function checkAvailability(professionalId: string, label: string) {
    console.log(`\n--- Checking Availability for: ${label} (${professionalId}) ---`);

    const date = new Date(DATE_ISO);

    // COPY OF LOGIC FROM availability.controller.ts
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    console.log(`Query Interval (Server Local?):`);
    console.log(`Start: ${dayStart.toString()} (${dayStart.toISOString()})`);
    console.log(`End:   ${dayEnd.toString()} (${dayEnd.toISOString()})`);

    const appointments = await prisma.appointment.findMany({
        where: {
            doctorId: professionalId,
            status: { not: 'CANCELLED' },
            date: {
                gte: dayStart,
                lte: dayEnd
            }
        },
        orderBy: { date: 'asc' }
    });

    console.log(`Found ${appointments.length} appointments.`);
    appointments.forEach(a => console.log(`- Appt: ${a.date.toISOString()} - ${(a.endDate || new Date(a.date.getTime() + a.duration * 60000)).toISOString()}`));

    // Slot Generation (Simplified)
    const workStartHour = 8;
    const workEndHour = 20;
    const slots: string[] = [];
    const now = new Date();

    let cursor = new Date(dayStart);
    cursor.setHours(workStartHour, 0, 0, 0);

    const endOfDay = new Date(dayStart);
    endOfDay.setHours(workEndHour, 0, 0, 0);

    while (cursor < endOfDay) {
        const slotEnd = new Date(cursor.getTime() + DURATION * 60000);

        // Collision Check
        const collision = appointments.find(appt => {
            const apptStart = new Date(appt.date);
            const apptEnd = appt.endDate ? new Date(appt.endDate) : new Date(apptStart.getTime() + appt.duration * 60000);
            return cursor < apptEnd && slotEnd > apptStart;
        });

        if (!collision) {
            // Only add if future (ignoring for this test)
            slots.push(cursor.toISOString());
        }

        // Increment
        cursor = new Date(cursor.getTime() + 30 * 60000); // Step 30 min
    }

    console.log(`Generated ${slots.length} free slots.`);
    // Check specific problematic slots
    const badSlots = ['10:00', '11:00', '11:30', '12:00'];
    badSlots.forEach(time => {
        const found = slots.find(s => s.includes(`T${time}`)); // Rough check
        if (found) console.log(`⚠️  BAD SLOT FOUND: ${time} (Should be taken)`);
    });
}

async function main() {
    await checkAvailability(USER_ID, 'USER ID');
    await checkAvailability(PROF_ID, 'PROFESSIONAL ID');
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
