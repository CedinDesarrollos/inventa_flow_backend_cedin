import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

// Mocks
const DATE_ISO = '2026-02-17T03:00:00.000Z';
const USER_ID = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
const DURATION = 30;

async function verifyFixes() {
    console.log(`\n--- Verifying Controller Fixes (No Offset + 10m Step) ---`);
    const userId = USER_ID;
    const date = new Date(DATE_ISO);

    // FIXED LOGIC
    const workStartHour = 8;
    const workEndHour = 20;
    const TZ_OFFSET = 0; // FIXED

    const scheduleStart = new Date(date);
    scheduleStart.setHours(workStartHour + TZ_OFFSET, 0, 0, 0);

    const scheduleEnd = new Date(date);
    scheduleEnd.setHours(workEndHour + TZ_OFFSET, 0, 0, 0);

    console.log(`Schedule: ${scheduleStart.toISOString()} - ${scheduleEnd.toISOString()}`);

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

    console.log(`Appointments Found:`);
    appointments.forEach(a => console.log(`- ${a.date.toISOString()} (${a.duration} min)`));

    // FIXED LOOP
    const SLOT_STEP = 10; // FIXED
    const slots: string[] = [];
    let cursor = new Date(scheduleStart);

    while (cursor.getTime() + DURATION * 60000 <= scheduleEnd.getTime()) {
        const slotEnd = new Date(cursor.getTime() + DURATION * 60000);

        const collision = appointments.find(appt => {
            const apptStart = new Date(appt.date);
            const apptEnd = appt.endDate ? new Date(appt.endDate) : new Date(apptStart.getTime() + appt.duration * 60000);
            return cursor < apptEnd && slotEnd > apptStart;
        });

        if (!collision) {
            slots.push(cursor.toISOString());
        }

        cursor = new Date(cursor.getTime() + SLOT_STEP * 60000);
    }

    console.log(`\nGenerated Slots (First 20):`);
    slots.slice(0, 20).forEach(s => console.log(s));

    // CHECKS
    const has900 = slots.some(s => s.includes('T09:00:00'));
    const has930 = slots.some(s => s.includes('T09:30:00'));
    const has1000 = slots.some(s => s.includes('T10:00:00'));

    console.log(`\nAssertions:`);
    console.log(`SLOT 09:00 should be BUSY (Found? ${has900}) -> ${!has900 ? 'PASS' : 'FAIL'}`);
    console.log(`SLOT 09:30 should be FREE (Found? ${has930}) -> ${has930 ? 'PASS' : 'FAIL'}`);
    console.log(`SLOT 10:00 should be BUSY (Found? ${has1000}) -> ${!has1000 ? 'PASS' : 'FAIL'}`);
}

verifyFixes()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
