import { TwilioProvider } from './providers/TwilioProvider';
import { BaileysProvider } from './providers/BaileysProvider';
import { IWhatsAppProvider } from './providers/IWhatsAppProvider';
import { prisma } from '../../lib/prisma';

export class NotificationService {
    private twilioProvider: TwilioProvider;
    private baileysProvider: BaileysProvider;

    constructor() {
        this.twilioProvider = new TwilioProvider();
        this.baileysProvider = new BaileysProvider();

        // Register incoming message handler
        this.baileysProvider.setMessageHandler(this.onBaileysMessage.bind(this));
    }

    async initialize() {
        await this.twilioProvider.initialize();
        // Don't await baileys strictly if it hangs on connection
        this.baileysProvider.initialize().catch(err => console.error('Failed to init Baileys', err));
    }

    /**
     * Send a message to a patient via WhatsApp
     * Uses hybrid strategy: Manual (userId present) -> Baileys, Automation -> Twilio
     */
    async sendMessage(params: {
        patientId: string;
        message: string;
        mediaUrl?: string;
        userId?: string;
        forceProvider?: 'twilio' | 'baileys';
    }) {
        const patient = await prisma.patient.findUnique({
            where: { id: params.patientId }
        });

        if (!patient?.phone) {
            throw new Error('Patient has no phone number');
        }

        // Determine provider
        let providerName = 'twilio';

        if (params.forceProvider) {
            providerName = params.forceProvider;
        } else if (params.userId) {
            // Manual response -> Prefer Baileys (Official Number)
            const status = await this.baileysProvider.getStatus();
            if (status.connected) {
                providerName = 'baileys';
            } else {
                console.warn('Baileys not connected, falling back to Twilio for manual message');
                providerName = 'twilio';
            }
        }

        const activeProvider: IWhatsAppProvider = providerName === 'baileys'
            ? this.baileysProvider
            : this.twilioProvider;

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: { patientId: params.patientId, channel: 'whatsapp' }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    patientId: params.patientId,
                    channel: 'whatsapp',
                    status: 'open'
                }
            });
            console.log(`✅ Created new conversation for patient ${patient.firstName} ${patient.lastName}`);
        }

        // Send via provider
        const result = await activeProvider.sendMessage({
            to: patient.phone,
            message: params.message,
            mediaUrl: params.mediaUrl
        });

        // Save to database
        await prisma.conversationMessage.create({
            data: {
                conversationId: conversation.id,
                content: params.message,
                type: params.mediaUrl ? this.getMessageType(params.mediaUrl) : 'text',
                sender: 'clinic',
                status: result.success ? 'sent' : 'failed',
                mediaUrl: params.mediaUrl,
                externalId: result.messageId,
                userId: params.userId,
                provider: providerName
            }
        });

        // Update conversation
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() }
        });

        return result;
    }

    /**
     * Send appointment reminder using approved template (Always Twilio for now)
     */
    async sendAppointmentReminder(params: {
        patientId: string;
        appointmentId: string;
        templateId: string;
        patientName: string;
        date: string;
        time: string;
        doctorName: string;
        branchName: string;
    }) {
        const patient = await prisma.patient.findUnique({
            where: { id: params.patientId }
        });

        if (!patient?.phone) {
            throw new Error('Patient has no phone number');
        }

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: { patientId: params.patientId, channel: 'whatsapp' }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    patientId: params.patientId,
                    channel: 'whatsapp',
                    status: 'open'
                }
            });
        }

        // Send via Twilio (Official Templates)
        const result = await this.twilioProvider.sendMessage({
            to: patient.phone,
            message: '', // Not used with templates
            templateId: params.templateId,
            templateParams: {
                '1': params.patientName,
                '2': params.date,
                '3': params.time,
                '4': params.doctorName,
                '5': params.branchName
            }
        });

        // Save to database
        await prisma.conversationMessage.create({
            data: {
                conversationId: conversation.id,
                content: `Recordatorio de cita: ${params.date} ${params.time}`,
                type: 'text',
                sender: 'clinic',
                status: result.success ? 'sent' : 'failed',
                externalId: result.messageId,
                provider: 'twilio'
            }
        });

        // Log notification
        await prisma.notificationLog.create({
            data: {
                appointmentId: params.appointmentId,
                type: 'REMINDER_24H',
                channel: 'WHATSAPP',
                status: result.success ? 'SENT' : 'FAILED',
                sentAt: result.success ? new Date() : null
            }
        });

        // Update conversation
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() }
        });

        return result;
    }

    // Proxy methods for Controller
    async getBaileysStatus() {
        return this.baileysProvider.getStatus();
    }

    async logoutBaileys() {
        return this.baileysProvider.logout();
    }

    /**
     * Handle incoming messages from Baileys (Official WhatsApp)
     */
    private async onBaileysMessage(m: any) {
        try {
            const { messages, type } = m;
            if (type !== 'notify') return;

            for (const msg of messages) {
                // Ignore messages sent by us
                if (msg.key.fromMe) continue;

                const remoteJid = msg.key.remoteJid;
                if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) continue;

                // Extract digits only for robust matching
                const phoneDigits = remoteJid.split('@')[0].replace(/\D/g, '');

                // Extract message content
                const content = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    (msg.message?.imageMessage ? '(Imagen)' : '') ||
                    (msg.message?.audioMessage ? '(Audio)' : '') ||
                    (msg.message?.videoMessage ? '(Video)' : '') ||
                    (msg.message?.documentMessage ? '(Documento)' : '') ||
                    '';

                if (!content && !msg.message?.imageMessage && !msg.message?.audioMessage) continue;

                // Find patient by phone - flexible matching
                let patient = await prisma.patient.findFirst({
                    where: {
                        phone: {
                            contains: phoneDigits.slice(-8) // Match last 8 digits for flexibility
                        }
                    }
                });

                if (!patient) {
                    console.log(`🆕 Creating auto-LEAD for unknown number: ${phoneDigits}`);
                    patient = await prisma.patient.create({
                        data: {
                            firstName: "WhatsApp User",
                            lastName: phoneDigits,
                            phone: phoneDigits,
                            identifier: `LEAD-BA-${phoneDigits}`,
                        }
                    });
                }

                // Find or create conversation
                let conversation = await prisma.conversation.findFirst({
                    where: { patientId: patient.id, channel: 'whatsapp' }
                });

                if (!conversation) {
                    conversation = await prisma.conversation.create({
                        data: {
                            patientId: patient.id,
                            channel: 'whatsapp',
                            status: 'open'
                        }
                    });
                }

                // Save message
                await prisma.conversationMessage.create({
                    data: {
                        conversationId: conversation.id,
                        content: content,
                        type: this.getBaileysMessageType(msg.message),
                        sender: 'patient',
                        status: 'delivered',
                        externalId: msg.key.id,
                        provider: 'baileys'
                    }
                });

                // Update conversation last message timestamp
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        lastMessageAt: new Date(),
                        unreadCount: { increment: 1 }
                    }
                });

                console.log(`📥 Saved incoming Baileys message from ${phoneDigits}`);
            }
        } catch (error) {
            console.error('Error processing Baileys message:', error);
        }
    }

    private getBaileysMessageType(message: any): string {
        if (message?.imageMessage) return 'image';
        if (message?.audioMessage) return 'audio';
        if (message?.videoMessage) return 'video';
        if (message?.documentMessage) return 'document';
        return 'text';
    }

    private getMessageType(url: string): string {
        const ext = url.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image';
        if (['mp3', 'ogg', 'wav'].includes(ext || '')) return 'audio';
        if (['mp4', 'mov'].includes(ext || '')) return 'video';
        return 'document';
    }
}

export const notificationService = new NotificationService();
