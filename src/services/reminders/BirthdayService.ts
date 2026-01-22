import { prisma } from '../../lib/prisma';
import { DateTime } from 'luxon';
import twilio from 'twilio';

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

const TEMPLATE_SID = 'HX4d6c324f66a95ff61469415a31dd9466';
const MEDIA_URL = 'https://www.cedin.com.py/img/happy_birthday_cedin_1080x1080.png';

export class BirthdayService {

    /**
     * Get timezone from system settings
     */
    private async getTimezone(): Promise<string> {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'timezone' }
        });
        return setting ? JSON.parse(setting.value as string) : 'America/Asuncion';
    }

    /**
     * Find patients having their birthday today
     */
    async findBirthdayPatients() {
        const timezone = await this.getTimezone();
        const now = DateTime.now().setZone(timezone);
        const currentMonth = now.month;
        const currentDay = now.day;

        // Fetch all active patients with phone numbers
        // Note: For larger databases, we should use a raw query to filter by date parts at DB level
        // But for this scale, in-memory filtering is safer and cleaner
        const allPatients = await prisma.patient.findMany({
            where: {
                status: 'ACTIVE',
                phone: { not: null },
                birthDate: { not: null }
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                birthDate: true
            }
        });

        // Filter for today's birthday
        return allPatients.filter(patient => {
            if (!patient.birthDate) return false;

            // Convert DB date (UTC) to System Timezone to check day/month match
            const birthDate = DateTime.fromJSDate(patient.birthDate).setZone(timezone);
            return birthDate.month === currentMonth && birthDate.day === currentDay;
        });
    }

    /**
     * Send birthday greeting to a single patient
     */
    async sendGreeting(patient: any): Promise<void> {
        try {
            console.log(`🎂 Sending birthday greeting to ${patient.firstName} ${patient.lastName} (${patient.phone})`);

            // Format Name for {{1}}
            const fullName = `${patient.firstName} ${patient.lastName}`;

            // Send via Twilio
            const message = await twilioClient.messages.create({
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: `whatsapp:${patient.phone}`,
                contentSid: TEMPLATE_SID,
                contentVariables: JSON.stringify({
                    '1': patient.firstName // Just First Name is friendlier for birthdays
                }),
                mediaUrl: [MEDIA_URL]
            });

            // Log the "Reminder" (We reuse the table, but maybe with null appointmentId or we don't log it there?)
            // The requirement didn't specify logging to DB, but it's good practice.
            // However, AppointmentReminder table strictly requires appointmentId?
            // Let's check schema. If appointmentId is optional, we can log. 
            // Checking previous schema view... AppointmentReminder has `appointmentId String`. It is NOT optional?
            // Wait, schema said: `appointmentId String`. It is required.
            // So we cannot use AppointmentReminder table for birthdays without an appointment.
            // We will just log to console for MVP as per plan.

            console.log(`✅ Birthday message sent successfully: ${message.sid}`);

        } catch (error: any) {
            console.error(`❌ Failed to send birthday greeting to ${patient.id}:`, error.message);
        }
    }

    /**
     * Process all birthday greetings
     */
    async processGreetings(): Promise<void> {
        console.log('🎉 Starting birthday greeting processing...');

        try {
            // Check if reminders/automations are enabled globally
            const enabledSetting = await prisma.systemSetting.findUnique({
                where: { key: 'reminders_enabled' }
            });

            const remindersEnabled = enabledSetting ? JSON.parse(enabledSetting.value as string) : false;

            if (!remindersEnabled) {
                console.log('⏸️  Automations are DISABLED in system settings. Skipping birthday greetings.');
                return;
            }

            const patients = await this.findBirthdayPatients();
            console.log(`📋 Found ${patients.length} patients with birthday today`);

            if (patients.length === 0) {
                return;
            }

            // Send greetings
            for (let i = 0; i < patients.length; i++) {
                await this.sendGreeting(patients[i]);

                // Small delay to be nice to API
                if (patients.length > 5 && i < patients.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            console.log(`✅ Birthday processing completed. Sent ${patients.length} greetings`);

        } catch (error) {
            console.error('❌ Error processing birthday greetings:', error);
            throw error;
        }
    }
}
