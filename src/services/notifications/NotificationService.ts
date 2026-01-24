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
            console.log(`📡 [WA-EVENT] ${type} (${messages?.length || 0} msgs)`);

            if (!messages) return;

            for (const msg of messages) {
                const remoteJid = msg.key.remoteJid;
                const fromMe = msg.key.fromMe;

                if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.includes('@g.us')) {
                    continue; // Skip status and groups
                }

                // Support both @s.whatsapp.net and @lid
                if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@lid')) {
                    console.log(`⏭️ [SKIP] Unknown JID format: ${remoteJid}`);
                    continue;
                }

                console.log(`📝 [MSG] ID: ${msg.key.id.slice(-6)} | FromMe: ${fromMe} | JID: ${remoteJid}`);

                // Deep extract content
                const extractContent = (m: any): string => {
                    if (!m) return '';
                    const actualMsg = m.message || m;
                    const body = actualMsg.conversation ||
                        actualMsg.extendedTextMessage?.text ||
                        actualMsg.imageMessage?.caption ||
                        actualMsg.videoMessage?.caption ||
                        actualMsg.documentMessage?.caption ||
                        actualMsg.templateButtonReplyMessage?.selectedDisplayText ||
                        actualMsg.buttonsResponseMessage?.selectedDisplayText ||
                        actualMsg.listResponseMessage?.title ||
                        (actualMsg.stickerMessage ? '(Sticker)' : '') ||
                        (actualMsg.imageMessage ? '(Imagen)' : '') ||
                        (actualMsg.audioMessage ? '(Audio)' : '') ||
                        (actualMsg.videoMessage ? '(Video)' : '') ||
                        (actualMsg.documentMessage ? '(Documento)' : '') ||
                        '';

                    if (body) return body;
                    if (actualMsg.message) return extractContent(actualMsg.message);
                    return '';
                };

                const content = extractContent(msg.message);
                const msgType = this.getBaileysMessageType(msg.message);

                // Phone number digits
                let phoneDigits = remoteJid.split('@')[0].replace(/\D/g, '');

                // IGNORE SELF (DYNAMICALLY)
                const myConnectedPhone = this.baileysProvider.getCurrentPhone();
                if (myConnectedPhone && (phoneDigits === myConnectedPhone || phoneDigits.endsWith(myConnectedPhone))) {
                    console.log(`🛑 [IGNORE-SELF] Skipping message from connected number: ${phoneDigits}`);
                    continue;
                }

                // LID Resolution
                let resolvedPhone: string | null = null;
                if (remoteJid.endsWith('@lid')) {
                    resolvedPhone = await this.baileysProvider.getPhoneNumberFromLid(remoteJid);
                    if (resolvedPhone) {
                        console.log(`🔄 [LID-RESOLVE] Mapped ${remoteJid} -> ${resolvedPhone}`);
                        phoneDigits = resolvedPhone;
                    }
                }

                const searchSuffix = phoneDigits.slice(-8);

                // Declare patient variable
                let patient: any = null;

                // 1. Try finding by LID (strongest match)
                if (remoteJid.endsWith('@lid')) {
                    patient = await prisma.patient.findUnique({
                        where: { lid: remoteJid } as any
                    });
                    if (patient) console.log(`✅ [MATCH-LID] Found ${patient.firstName} by LID`);
                }

                // 2. If not found by LID, try by Phone
                if (!patient) {
                    patient = await prisma.patient.findFirst({
                        where: { phone: { contains: searchSuffix } }
                    });

                    // If found by phone but has no LID, link it!
                    if (patient && remoteJid.endsWith('@lid') && !patient.lid) {
                        try {
                            await prisma.patient.update({
                                where: { id: patient.id },
                                data: { lid: remoteJid } as any
                            });
                            console.log(`🔗 [LINK] Auto-linked LID ${remoteJid} to ${patient.firstName}`);
                        } catch (e) {
                            console.error('Failed to auto-link LID', e);
                        }
                    }
                }

                if (!patient) {
                    if (fromMe) {
                        console.log(`⏭️ [MIRROR-SKIP] Outgoing for unknown number: ${phoneDigits}`);
                        continue;
                    }
                    console.log(`🆕 [LEAD] Creating for ${phoneDigits}`);
                    patient = await prisma.patient.create({
                        data: {
                            firstName: "WhatsApp User",
                            lastName: phoneDigits,
                            phone: phoneDigits,
                            identifier: `LEAD-BA-${phoneDigits}`,
                            lid: remoteJid.endsWith('@lid') ? remoteJid : undefined
                        } as any
                    });
                }

                // Get conversation
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

                // Duplicate check
                const exists = await prisma.conversationMessage.findFirst({
                    where: { externalId: msg.key.id }
                });
                if (exists) continue;

                // Fix Timestamp
                let msgDate = new Date();
                if (msg.messageTimestamp) {
                    // Safe conversion for Long or number
                    const ts = typeof msg.messageTimestamp === 'number'
                        ? msg.messageTimestamp
                        : (msg.messageTimestamp as any).toNumber ? (msg.messageTimestamp as any).toNumber() : Number(msg.messageTimestamp);

                    if (!isNaN(ts)) {
                        msgDate = new Date(ts * 1000);
                    }
                }

                // Save message
                await prisma.conversationMessage.create({
                    data: {
                        conversationId: conversation.id,
                        content: content || (msgType === 'text' ? '' : `(Archivo: ${msgType})`),
                        type: msgType,
                        sender: fromMe ? 'clinic' : 'patient',
                        status: 'delivered',
                        externalId: msg.key.id,
                        provider: 'baileys',
                        sentAt: msgDate
                    }
                });

                // Update conversation
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        lastMessageAt: new Date(),
                        unreadCount: fromMe ? undefined : { increment: 1 }
                    }
                });

                console.log(`✅ [SYNC] ${fromMe ? 'Mirror' : 'Incoming'} saved for ${patient.firstName}`);
            }
        } catch (error) {
            console.error('❌ [CRASH] onBaileysMessage:', error);
        }
    }

    private getBaileysMessageType(message: any): string {
        if (!message) return 'text';
        // Handle nested messages
        const m = message.message || message;
        if (m.imageMessage) return 'image';
        if (m.audioMessage) return 'audio';
        if (m.videoMessage) return 'video';
        if (m.documentMessage) return 'document';
        if (m.stickerMessage) return 'sticker';
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
