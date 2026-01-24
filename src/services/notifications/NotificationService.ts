import { TwilioProvider } from './providers/TwilioProvider';
import { IWhatsAppProvider } from './providers/IWhatsAppProvider';
import { prisma } from '../../lib/prisma';

export class NotificationService {
    private provider: IWhatsAppProvider;

    constructor() {
        const providerType = process.env.WHATSAPP_PROVIDER || 'twilio';

        switch (providerType) {
            case 'twilio':
                this.provider = new TwilioProvider();
                break;
            // Future: case 'baileys': this.provider = new BaileysProvider();
            default:
                throw new Error(`Unknown WhatsApp provider: ${providerType}`);
        }
    }

    async initialize() {
        await this.provider.initialize();
    }

    /**
     * Send a message to a patient via WhatsApp
     */
    async sendMessage(params: {
        patientId: string;
        message: string;
        mediaUrl?: string;
        userId?: string;
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
            console.log(`✅ Created new conversation for patient ${patient.firstName} ${patient.lastName}`);
        }

        // Send via provider
        const result = await this.provider.sendMessage({
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
                userId: params.userId
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
     * Send appointment reminder using approved template (Phase 2)
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

        // Send via provider with template
        const result = await this.provider.sendMessage({
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
                externalId: result.messageId
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

    private getMessageType(url: string): string {
        const ext = url.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image';
        if (['mp3', 'ogg', 'wav'].includes(ext || '')) return 'audio';
        if (['mp4', 'mov'].includes(ext || '')) return 'video';
        return 'document';
    }
}
