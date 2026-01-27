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
    /**
     * Get system settings for reminders
     */
    private async getSystemSettings(): Promise<SystemSettings> {
        // Fetch specific keys and legacy config
        const settings = await prisma.systemSetting.findMany({
            where: {
                key: {
                    in: ['timezone', 'reminder_hours_before', 'reminder_window_start', 'reminder_window_end', 'CLINIC_CONFIG']
                }
            }
        });

        // Parse legacy config if exists
        const legacySetting = settings.find(s => s.key === 'CLINIC_CONFIG');
        const legacyConfig = legacySetting && legacySetting.value ? (legacySetting.value as any) : {};

        const settingsMap = settings.reduce((acc, setting) => {
            if (setting.key !== 'CLINIC_CONFIG') {
                acc[setting.key] = setting.value; // Individual keys take precedence if they exist
            }
            return acc;
        }, {} as any);

        // Merge: Default < Legacy < Individual
        return {
            timezone: settingsMap.timezone || legacyConfig.timezone || 'America/Asuncion',
            reminder_hours_before: settingsMap.reminder_hours_before || legacyConfig.reminder_hours_before || 24,
            reminder_window_start: settingsMap.reminder_window_start || legacyConfig.reminder_window_start || '09:00',
            reminder_window_end: settingsMap.reminder_window_end || legacyConfig.reminder_window_end || '18:00'
        };
    }

    /**
     * Find appointments eligible for reminders
     * DUAL STRATEGY:
     * - At 6pm: Send ALL appointments for tomorrow (batch)
     * - Other hours: Send appointments in 23-25 hour window
     */
    /**
     * Find appointments eligible for reminders
     * DUAL STRATEGY:
     * - At 6pm: Send ALL appointments for tomorrow (batch)
     * - Other hours: Send appointments in 23-25 hour window
     */
    async findEligibleAppointments() {
        const settings = await this.getSystemSettings();
        const timezone = settings.timezone;

        // Fix: Use keepLocalTime to map Local Time directly to UTC slot
        // e.g. 10:30 Asuncion -> 10:30 UTC.
        // This matches the DB convention where "10:30" is stored as "10:30 UTC".
        const now = DateTime.now().setZone(timezone);
        const nowAsUtcSlot = now.setZone('UTC', { keepLocalTime: true });

        const currentHour = now.hour; // Use local hour to decide strategy

        // STRATEGY 1: BATCH AT 6PM - Send ALL tomorrow's appointments
        if (currentHour === 18) {
            console.log('🎯 Running BATCH mode: sending all reminders for tomorrow');

            const tomorrow = nowAsUtcSlot.plus({ days: 1 }).startOf('day');
            const endOfTomorrow = tomorrow.endOf('day');

            return await prisma.appointment.findMany({
                where: {
                    date: {
                        gte: tomorrow.toJSDate(),
                        lte: endOfTomorrow.toJSDate()
                    },
                    status: {
                        in: ['SCHEDULED', 'CONFIRMED']
                    },
                    reminders: {
                        none: {
                            status: {
                                in: ['sent', 'delivered', 'read', 'confirmed', 'cancelled', 'rescheduled']
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
        const targetStart = nowAsUtcSlot.plus({ hours: hoursBefore - 1 });
        const targetEnd = nowAsUtcSlot.plus({ hours: hoursBefore + 1 });

        return await prisma.appointment.findMany({
            where: {
                date: {
                    gte: targetStart.toJSDate(),
                    lte: targetEnd.toJSDate()
                },
                status: {
                    in: ['SCHEDULED', 'CONFIRMED']
                },
                reminders: {
                    none: {
                        status: {
                            in: ['sent', 'delivered', 'read', 'confirmed', 'cancelled', 'rescheduled']
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

        // Fix: Use UTC directly because the DB stores "Visual Time" in UTC slot.
        // We do NOT want to shift it to local timezone, or it will be wrong.
        const outputZone = 'UTC';

        // {{1}} = Patient name (e.g., "Ana García")
        const patientName = `${patient.firstName} ${patient.lastName}`;

        // {{2}} = Day and date (e.g., "martes 22 de enero")
        // Use outputZone (UTC) to preserve the stored time
        const appointmentDate = DateTime.fromJSDate(date)
            .setZone(outputZone)
            .setLocale('es')
            .toFormat("cccc d 'de' MMMM");

        // {{3}} = Time (e.g., "10:00 am")
        // Use outputZone (UTC) to preserve the stored time
        const appointmentTime = DateTime.fromJSDate(date)
            .setZone(outputZone)
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
            // Determine sender number from env vars (handle potential 'whatsapp:' prefix in env)
            let senderNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
            if (senderNumber && senderNumber.startsWith('whatsapp:')) {
                senderNumber = senderNumber.replace('whatsapp:', '');
            }

            const message = await twilioClient.messages.create({
                from: `whatsapp:${senderNumber}`,
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
            // Check if reminders are enabled (Check both individual key and legacy blob)
            const settings = await prisma.systemSetting.findMany({
                where: {
                    key: {
                        in: ['reminders_enabled', 'CLINIC_CONFIG']
                    }
                }
            });

            const indivEnabled = settings.find(s => s.key === 'reminders_enabled');
            const legacySetting = settings.find(s => s.key === 'CLINIC_CONFIG');
            const legacyConfig = legacySetting && legacySetting.value ? (legacySetting.value as any) : {};

            // Logic: If individual key exists, use it. Else check legacy. Default false.
            let remindersEnabled = false;

            if (indivEnabled) {
                remindersEnabled = JSON.parse(indivEnabled.value as string);
            } else if (legacyConfig.reminders_enabled !== undefined) {
                remindersEnabled = legacyConfig.reminders_enabled;
                console.log('ℹ️  Using LEGACY config for reminders_enabled');
            }

            if (!remindersEnabled) {
                console.log('⏸️  Reminders are DISABLED in system settings. Skipping send.');
                console.log('💡 To enable: Set "reminders_enabled" to true in Variables del Sistema');
                return;
            }

            // Check if specific campaign is enabled
            const campaign = await prisma.automationCampaign.findUnique({
                where: { key: 'appointment_reminders' }
            });

            if (!campaign || !campaign.isEnabled) {
                console.log('⏸️  Appointment Reminders campaign is explicitly DISABLED. Skipping.');
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
