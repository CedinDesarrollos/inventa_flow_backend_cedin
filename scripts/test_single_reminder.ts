
import dotenv from 'dotenv';
// Load env BEFORE imports that might rely on process.env
const result = dotenv.config();

// Fix: Map the existing env var to what the service expects
if (process.env.TWILIO_WHATSAPP_NUMBER && !process.env.TWILIO_PHONE_NUMBER) {
    // Remove 'whatsapp:' prefix if present, as the service seems to prepend it in some places?
    // Wait, ReminderService does: from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`
    // But .env has: TWILIO_WHATSAPP_NUMBER=whatsapp:+123...
    // We should strip the prefix to avoid double prefixing.
    const rawNumber = process.env.TWILIO_WHATSAPP_NUMBER.replace('whatsapp:', '');
    process.env.TWILIO_PHONE_NUMBER = rawNumber;
    console.log(`🔌 Mapped TWILIO_WHATSAPP_NUMBER to TWILIO_PHONE_NUMBER: ${rawNumber}`);
}

// Now import the service
import { prisma } from '../src/lib/prisma';
import { ReminderService } from '../src/services/reminders/ReminderService';

const APPOINTMENT_ID = '95cfd048-b847-4dba-aa6f-899f03914df3';
const TEST_PHONE = '+595981514767';

async function run() {
    console.log(`🚀 Starting Live Test for Appointment: ${APPOINTMENT_ID}`);
    console.log(`📱 Target Phone (Override): ${TEST_PHONE}`);
    console.log(`🔌 Twilio Phone Source: ${process.env.TWILIO_PHONE_NUMBER || 'UNDEFINED'}`);

    try {
        // 1. Fetch Appointment with relations
        const appointment = await prisma.appointment.findUnique({
            where: { id: APPOINTMENT_ID },
            include: {
                patient: true,
                doctor: {
                    include: {
                        professional: true
                    }
                },
                branch: true
            }
        });

        if (!appointment) {
            console.error('❌ Appointment not found!');
            return;
        }

        console.log(`📋 Found Appointment for: ${appointment.patient.firstName} ${appointment.patient.lastName}`);
        console.log(`📅 Date (DB UTC): ${appointment.date.toISOString()}`);
        console.log(`📞 Original Phone: ${appointment.patient.phone}`);

        // 2. Override Phone Number (In Memory Only)
        const appointmentForTest = {
            ...appointment,
            patient: {
                ...appointment.patient,
                phone: TEST_PHONE
            }
        };

        // 3. Send Reminder
        const reminderService = new ReminderService();
        console.log('\n📤 Sending Reminder...');
        await reminderService.sendReminder(appointmentForTest);

        console.log('\n✅ Test execution completed.');
        console.log('Check your WhatsApp!');

    } catch (error) {
        console.error('❌ Test passed with errors:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
