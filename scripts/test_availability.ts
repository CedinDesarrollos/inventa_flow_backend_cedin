import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

// Mock params
const DATE_ISO = '2026-02-17T03:00:00.000Z'; // As sent by frontend (typically)
const USER_ID = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
const DURATION = 30;

async function checkNoOffset() {
    console.log(`\n--- Checking Availability with NO OFFSET (UTC Face Value) ---`);
    const userId = USER_ID;
    const date = new Date(DATE_ISO);

    // TEST: Remove Offset (Assume 8am = 08:00 UTC because DB has 09:00 UTC for 9am)
    const workStartHour = 8;
    const workEndHour = 20; // 8pm
    const TZ_OFFSET = 0; // Was 3

    const scheduleStart = new Date(date);
    scheduleStart.setHours(workStartHour + TZ_OFFSET, 0, 0, 0);

    const scheduleEnd = new Date(date);
    scheduleEnd.setHours(workEndHour + TZ_OFFSET, 0, 0, 0);

    console.log(`Schedule Interval: ${scheduleStart.toISOString()} - ${scheduleEnd.toISOString()}`);

    const appointments = await prisma.appointment.findMany({
        where: {
            doctorId: userId,
            status: { not: 'CANCELLED' },
            date: {
                gte: scheduleStart,
                lte: scheduleEnd
            }
        },
        orderBy: { date: 'asc' }
    });

    console.log(`Found ${appointments.length} appointments.`);
    appointments.forEach(a => console.log(`- Appt: ${a.date.toISOString()} (Duration: ${a.duration})`));

    const slots: string[] = [];
    let cursor = new Date(scheduleStart);

    while (cursor.getTime() + DURATION * 60000 <= scheduleEnd.getTime()) {
        const slotEnd = new Date(cursor.getTime() + DURATION * 60000);

        // Dynamic Anchor Logic (Option B - reduced)
        // If collision, jump to end of appt. Else add slot.
        const collision = appointments.find(appt => {
            const apptStart = new Date(appt.date);
            const apptEnd = appt.endDate ? new Date(appt.endDate) : new Date(apptStart.getTime() + appt.duration * 60000);
            return cursor < apptEnd && slotEnd > apptStart;
        });

        if (collision) {
            console.log(`  [COLLISION] at ${cursor.toISOString()} with Appt ${collision.date.toISOString()}`);
            const apptStart = new Date(collision.date);
            const apptEnd = collision.endDate ? new Date(collision.endDate) : new Date(apptStart.getTime() + collision.duration * 60000);
            cursor = apptEnd;
        } else {
            slots.push(cursor.toISOString());
            cursor = new Date(cursor.getTime() + DURATION * 60000); // 30 min step
        }
    }

    console.log(`Generated ${slots.length} free slots.`);
    slots.forEach(s => console.log(`Slot: ${s}`));
}

async function main() {
    await checkNoOffset();
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
