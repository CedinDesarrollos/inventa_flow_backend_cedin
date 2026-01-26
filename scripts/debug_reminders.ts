
import { DateTime } from 'luxon';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load Env Wars
const envPath = path.resolve(process.cwd(), 'backend/.env');
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

async function main() {
    // Dynamic import to ensure env vars are loaded first
    const { prisma } = await import('../src/lib/prisma');

    console.log('--- DEBUG REMINDER LOGIC ---');

    // 1. Check System Settings
    const settings = await prisma.systemSetting.findMany({
        where: {
            key: { in: ['timezone', 'reminder_hours_before', 'CLINIC_CONFIG', 'reminders_enabled'] }
        }
    });

    console.log('System Settings in DB:', JSON.stringify(settings, null, 2));

    let timezone = 'America/Asuncion'; // Default
    const tzSetting = settings.find(s => s.key === 'timezone');
    if (tzSetting && typeof tzSetting.value === 'string' && tzSetting.value.trim() !== '') {
        timezone = tzSetting.value;
    } else {
        // Check legacy
        const legacy = settings.find(s => s.key === 'CLINIC_CONFIG');
        if (legacy && legacy.value) {
            const val = legacy.value as any;
            if (val.timezone && val.timezone.trim() !== '') timezone = val.timezone;
        }
    }
    console.log('Resolved Timezone:', timezone);

    // 2. Simulate Current Time
    const now = DateTime.now().setZone(timezone);
    console.log('Current Local Time:', now.toString());
    console.log('Current Hour:', now.hour);

    // 3. Simulate "Normal" Window (23-25h)
    const hoursBefore = 24;
    const nowAsUtcSlot = now.setZone('UTC', { keepLocalTime: true });

    // Logic from ReminderService
    const targetStart = nowAsUtcSlot.plus({ hours: hoursBefore - 1 });
    const targetEnd = nowAsUtcSlot.plus({ hours: hoursBefore + 1 });

    console.log(`\n[NORMAL MODE SIMULATION]`);
    console.log(`Looking for appointments between:`);
    console.log(`Start: ${targetStart.toFormat('yyyy-MM-dd HH:mm')} (UTC Slot)`);
    console.log(`End:   ${targetEnd.toFormat('yyyy-MM-dd HH:mm')} (UTC Slot)`);

    // 4. Check Pending Appointments for Tomorrow
    const tomorrow = nowAsUtcSlot.plus({ days: 1 }).startOf('day');
    const endOfTomorrow = tomorrow.endOf('day');

    console.log(`\n[TOMORROW CHECK: ${tomorrow.toFormat('yyyy-MM-dd')}]`);
    const allAppointments = await prisma.appointment.count({
        where: {
            date: { gte: tomorrow.toJSDate(), lte: endOfTomorrow.toJSDate() },
            status: { in: ['SCHEDULED', 'CONFIRMED'] }
        }
    });

    const pendingAppointments = await prisma.appointment.count({
        where: {
            date: { gte: tomorrow.toJSDate(), lte: endOfTomorrow.toJSDate() },
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            reminders: {
                none: { status: { in: ['sent', 'delivered', 'read'] } }
            }
        }
    });

    console.log(`Total appointments tomorrow: ${allAppointments}`);
    console.log(`Pending reminders (unsent) tomorrow: ${pendingAppointments}`);

    if (pendingAppointments > 0) {
        console.log(`\n✅ "BATCH MODE" at 18:00 will pick up these ${pendingAppointments} appointments.`);
    }
}

main().catch(e => console.error(e));
