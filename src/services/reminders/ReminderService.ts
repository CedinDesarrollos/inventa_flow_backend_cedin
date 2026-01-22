import { prisma } from '../../lib/prisma';
import { DateTime } from 'luxon';
import twilio from 'twilio';

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

const TEMPLATE_SID = 'HX40909b18131f8d6abe28986786a1f845';

interface SystemSettings {
    timezone: string;
    reminder_hours_before: number;
    reminder_window_start: string;
    reminder_window_end: string;
}

export class ReminderService {

    /**
     * Get system settings for reminders
     */
    private async getSystemSettings(): Promise<SystemSettings> {
        const settings = await prisma.systemSetting.findMany({
            where: {
                key: {
                    in: ['timezone', 'reminder_hours_before', 'reminder_window_start', 'reminder_window_end']
                }
            }
        });

        const settingsMap = settings.reduce((acc, setting) => {
            acc[setting.key] = JSON.parse(setting.value as string);
            return acc;
        }, {} as any);

        return {
            timezone: settingsMap.timezone || 'America/Asuncion',
            reminder_hours_before: settingsMap.reminder_hours_before || 24,
            reminder_window_start: settingsMap.reminder_window_start || '09:00',
            reminder_window_end: settingsMap.reminder_window_end || '18:00'
        };
    }

    /**
     * Find appointments eligible for reminders
     * DUAL STRATEGY:
     * - At 6pm: Send ALL appointments for tomorrow (batch)
     * - Other hours: Send appointments in 23-25 hour window
     */
    async findEligibleAppointments() {
        const settings = await this.getSystemSettings();
        const timezone = settings.timezone;
        const now = DateTime.now().setZone(timezone);
        const currentHour = now.hour;

        // STRATEGY 1: BATCH AT 6PM - Send ALL tomorrow's appointments
        if (currentHour === 18) {
            console.log('🎯 Running BATCH mode: sending all reminders for tomorrow');

            const tomorrow = now.plus({ days: 1 }).startOf('day');
            const endOfTomorrow = tomorrow.endOf('day');

            return await prisma.appointment.findMany({
                where: {
                    date: {
                        gte: tomorrow.toJSDate(),
                        lte: endOfTomorrow.toJSDate()
                    },
                    status: {
                        in: ['SCHEDULED', 'CONFIRMED', 'PENDING']
                    },
                    reminders: {
                        none: {
                            status: {
                                in: ['sent', 'delivered', 'read']
                            }
                        }
                    }
                },
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
        }

        // STRATEGY 2: NORMAL - 23-25 hour window
        console.log('⏰ Running NORMAL mode: 23-25 hour window');

        const hoursBefore = settings.reminder_hours_before;
        const targetStart = now.plus({ hours: hoursBefore - 1 });
        const targetEnd = now.plus({ hours: hoursBefore + 1 });

        return await prisma.appointment.findMany({
            where: {
                date: {
                    gte: targetStart.toJSDate(),
                    lte: targetEnd.toJSDate()
                },
                status: {
                    in: ['SCHEDULED', 'CONFIRMED', 'PENDING']
                },
                reminders: {
                    none: {
                        status: {
                            in: ['sent', 'delivered', 'read']
                        }
                    }
                }
            },
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
    }

    /**
     * Format template parameters for Twilio
     */
    private formatTemplateParams(appointment: any, settings: SystemSettings): string[] {
        const { patient, doctor, branch, date } = appointment;
        const timezone = settings.timezone;

        // {{1}} = Patient name (e.g., "Ana García")
        const patientName = `${patient.firstName} ${patient.lastName}`;

        // {{2}} = Day and date (e.g., "martes 22 de enero")
        const appointmentDate = DateTime.fromJSDate(date)
            .setZone(timezone)
            .setLocale('es')
            .toFormat("cccc d 'de' MMMM");

        // {{3}} = Time (e.g., "10:00 am")
        const appointmentTime = DateTime.fromJSDate(date)
            .setZone(timezone)
            .toFormat('hh:mm a');

        // {{4}} = Professional with prefix (e.g., "el Dr. Jorge Jara")
        const professional = doctor?.professional;
        let professionalName = 'el Dr. Desconocido';

        if (professional) {
            const prefix = professional.prefix || 'el Dr.';
            professionalName = `${prefix} ${professional.firstName} ${professional.lastName}`;
        }

        // {{5}} = Branch name (e.g., "Cedin Asunción")
        const branchName = branch?.name || 'Nuestra clínica';

        return [patientName, appointmentDate, appointmentTime, professionalName, branchName];
    }

    /**
     * Send reminder for a single appointment
     */
    async sendReminder(appointment: any): Promise<void> {
        const { patient } = appointment;

        try {
            // Create reminder record (status: pending)
            const reminder = await prisma.appointmentReminder.create({
                data: {
                    appointmentId: appointment.id,
                    status: 'pending'
                }
            });

            console.log(`📤 Sending reminder for appointment ${appointment.id} to ${patient.firstName} ${patient.lastName}`);

            // Get settings for template formatting
            const settings = await this.getSystemSettings();
            const templateParams = this.formatTemplateParams(appointment, settings);

            // Send via Twilio
            const message = await twilioClient.messages.create({
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: `whatsapp:${patient.phone}`,
                contentSid: TEMPLATE_SID,
                contentVariables: JSON.stringify({
                    '1': templateParams[0],
                    '2': templateParams[1],
                    '3': templateParams[2],
                    '4': templateParams[3],
                    '5': templateParams[4]
                })
            });

            // Update reminder with success
            await prisma.appointmentReminder.update({
                where: { id: reminder.id },
                data: {
                    status: 'sent',
                    sentAt: new Date(),
                    twilioMessageSid: message.sid
                }
            });

            console.log(`✅ Reminder sent successfully: ${message.sid}`);

        } catch (error: any) {
            console.error(`❌ Failed to send reminder for appointment ${appointment.id}:`, error.message);

            // Try to find the reminder record
            const existingReminder = await prisma.appointmentReminder.findFirst({
                where: { appointmentId: appointment.id }
            });

            if (existingReminder) {
                // Check retry count
                if (existingReminder.retryCount < 1) {
                    // Update with error and increment retry count
                    await prisma.appointmentReminder.update({
                        where: { id: existingReminder.id },
                        data: {
                            status: 'failed',
                            errorMessage: error.message,
                            retryCount: { increment: 1 }
                        }
                    });
                    console.log(`⚠️  Will retry on next cron execution (retry ${existingReminder.retryCount + 1}/1)`);
                } else {
                    // Max retries reached
                    await prisma.appointmentReminder.update({
                        where: { id: existingReminder.id },
                        data: {
                            status: 'failed',
                            errorMessage: `Max retries reached. Last error: ${error.message}`
                        }
                    });
                    console.log(`❌ Max retries reached for appointment ${appointment.id}`);
                }
            }
        }
    }

    /**
     * Process all eligible appointments
     */
    async processReminders(): Promise<void> {
        console.log('🔔 Starting reminder processing...');

        try {
            // Check if reminders are enabled
            const enabledSetting = await prisma.systemSetting.findUnique({
                where: { key: 'reminders_enabled' }
            });

            const remindersEnabled = enabledSetting ? JSON.parse(enabledSetting.value as string) : false;

            if (!remindersEnabled) {
                console.log('⏸️  Reminders are DISABLED in system settings. Skipping send.');
                console.log('💡 To enable: Set "reminders_enabled" to true in Variables del Sistema');
                return;
            }

            console.log('✅ Reminders are ENABLED. Proceeding with send...');

            const appointments = await this.findEligibleAppointments();
            console.log(`📋 Found ${appointments.length} appointments eligible for reminders`);

            if (appointments.length === 0) {
                console.log('✅ No reminders to send');
                return;
            }

            // Send reminders with small delay between each to avoid rate limiting
            for (let i = 0; i < appointments.length; i++) {
                const appointment = appointments[i];
                await this.sendReminder(appointment);

                // Add 100ms delay between sends if there are many appointments
                if (appointments.length > 10 && i < appointments.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            console.log(`✅ Reminder processing completed. Sent ${appointments.length} reminders`);

        } catch (error) {
            console.error('❌ Error processing reminders:', error);
            throw error;
        }
    }

    /**
     * Process patient response from webhook
     * (To be implemented when handling Twilio webhooks for button responses)
     */
    async processPatientResponse(messageId: string, response: 'confirmed' | 'cancelled' | 'rescheduled'): Promise<void> {
        const reminder = await prisma.appointmentReminder.findFirst({
            where: { twilioMessageSid: messageId }
        });

        if (reminder) {
            await prisma.appointmentReminder.update({
                where: { id: reminder.id },
                data: { patientResponse: response }
            });
            console.log(`✅ Updated patient response for reminder ${reminder.id}: ${response}`);
        }
    }
}
