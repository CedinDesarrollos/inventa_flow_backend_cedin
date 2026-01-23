
import { prisma } from '../../lib/prisma';
import { DateTime } from 'luxon';
import twilio from 'twilio';

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Template SID approved by User
const NPS_TEMPLATE_SID = 'HXcae66b5442151402a2e7193448b19e10';

export class NpsService {

    /**
     * Trigger NPS Survey for appointments finished ~2 hours ago
     * Runs hourly via Cron
     */
    async triggerBatch(): Promise<void> {
        console.log('📊 Starting NPS Batch Trigger...');
        const now = DateTime.now().setZone('America/Asuncion'); // Default fallback

        // 1. Check Global Switch
        const globalSetting = await prisma.systemSetting.findUnique({ where: { key: 'reminders_enabled' } });
        const isGlobalEnabled = globalSetting ? JSON.parse(globalSetting.value as string) : false;
        if (!isGlobalEnabled) return console.log('⏸️ Global automations disabled. Skipping NPS.');

        // 2. Check Campaign Switch
        const campaign = await prisma.automationCampaign.findUnique({ where: { key: 'nps_post_appointment' } });
        if (!campaign || !campaign.isEnabled) return console.log('⏸️ NPS Campaign disabled. Skipping.');

        // 3. Find Eligible Appointments (Ended between 2h and 3h ago)
        // We use a 1-hour window to catch them in the hourly cron
        const twoHoursAgo = now.minus({ hours: 2 });
        const threeHoursAgo = now.minus({ hours: 3 });

        const appointments = await prisma.appointment.findMany({
            where: {
                status: 'COMPLETED', // Specifically completed appointments
                endDate: {
                    gte: threeHoursAgo.toJSDate(),
                    lte: twoHoursAgo.toJSDate()
                },
                // Ensure we haven't sent NPS yet
                npsResponse: {
                    is: null
                }
            },
            include: {
                patient: true
            }
        });

        console.log(`📋 Found ${appointments.length} appointments for NPS`);

        for (const app of appointments) {
            await this.sendInitialSurvey(app);
        }
    }

    /**
     * Send the initial Question (1-3-5 Buttons)
     */
    private async sendInitialSurvey(appointment: any) {
        try {
            if (!appointment.patient.phone) return;

            // Create PENDING_SCORE record
            await prisma.npsResponse.create({
                data: {
                    appointmentId: appointment.id,
                    patientPhone: appointment.patient.phone,
                    status: 'PENDING_SCORE',
                    sentAt: new Date()
                }
            });

            // Send Twilio Template
            await twilioClient.messages.create({
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: `whatsapp:${appointment.patient.phone}`,
                contentSid: NPS_TEMPLATE_SID,
                contentVariables: JSON.stringify({
                    '1': appointment.patient.firstName
                })
            });

            console.log(`📤 NPS Survey sent to ${appointment.patient.firstName}`);

        } catch (error) {
            console.error(`❌ Failed to send NPS to appt ${appointment.id}:`, error);
        }
    }

    /**
     * Handle Incoming Webhook
     * Returns true if message was handled as NPS
     */
    async handleIncomingMessage(phone: string, body: string, isButton: boolean): Promise<boolean> {
        // Find active NPS Session
        // We look for any PENDING session for this phone (most recent)
        const activeSummary = await prisma.npsResponse.findFirst({
            where: {
                patientPhone: phone,
                status: {
                    in: ['PENDING_SCORE', 'PENDING_COMMENT']
                }
            },
            orderBy: { sentAt: 'desc' }
        });

        if (!activeSummary) {
            return false;
        }

        // Logic branching based on State
        if (activeSummary.status === 'PENDING_SCORE') {
            await this.handleScoreSubmission(activeSummary, body);
            return true;
        } else if (activeSummary.status === 'PENDING_COMMENT') {
            await this.handleCommentSubmission(activeSummary, body);
            return true;
        }

        return false;
    }

    private async handleScoreSubmission(nps: any, buttonPayload: string) {
        // Map payload to score
        // Button Texts: "Mala", "Regular", "Excelente"
        let score = 0;
        const input = buttonPayload.toLowerCase().trim();
        if (input.includes('mala')) score = 1;
        else if (input.includes('regular')) score = 3;
        else if (input.includes('excelente')) score = 5;
        else {
            // Fallback if they typed generic text instead of clicking
            console.log(`⚠️ Unrecognized score input: ${buttonPayload}`);
            return;
        }

        // Update DB: Save Score + Set timeout window (4 hours)
        const expiresAt = DateTime.now().plus({ hours: 4 }).toJSDate();

        await prisma.npsResponse.update({
            where: { id: nps.id },
            data: {
                score,
                status: 'PENDING_COMMENT',
                scoreReceivedAt: new Date(),
                expiresAt
            }
        });

        // Send Follow-up Text
        const message = "¡Gracias! 💙 ¿Nos contarías brevemente qué podríamos mejorar? (Si prefieres no detallar, puedes ignorar este mensaje).";
        await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
            to: `whatsapp:${nps.patientPhone}`,
            body: message
        });
    }

    private async handleCommentSubmission(nps: any, text: string) {
        // Check Timeout
        if (nps.expiresAt && new Date() > nps.expiresAt) {
            console.log(`⏳ NPS session expired for ${nps.id}. Treating as new message.`);
            // Logic to treat as new message (e.g. create conversation) would go here
            return;
        }

        // Save Comment & Close
        await prisma.npsResponse.update({
            where: { id: nps.id },
            data: {
                comment: text,
                status: 'COMPLETED',
                commentReceivedAt: new Date()
            }
        });

        // Final Thank You
        await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
            to: `whatsapp:${nps.patientPhone}`,
            body: "¡Gracias por tu feedback! Nos ayuda mucho a crecer. 🙌"
        });
    }
}
