import { TwilioProvider } from './providers/TwilioProvider';
import { BaileysProvider } from './providers/BaileysProvider';
import { IWhatsAppProvider } from './providers/IWhatsAppProvider';
import { prisma } from '../../lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

export class NotificationService {
    private twilioProvider: TwilioProvider;
    private baileysProvider: BaileysProvider;

    constructor() {
        this.twilioProvider = new TwilioProvider();
        this.baileysProvider = new BaileysProvider();

        // Register incoming message handler
        this.baileysProvider.setMessageHandler(this.onBaileysMessage.bind(this));

        // Register update handler (Read receipts)
        this.baileysProvider.setMessageUpdateHandler(this.onBaileysMessageUpdate.bind(this));

        // Register chat update handler (Sync read status from phone)
        this.baileysProvider.setChatUpdateHandler(this.onBaileysChatUpdate.bind(this));
    }

    private async onBaileysChatUpdate(updates: any[]) {
        for (const update of updates) {
            console.log(`📡 [CHATS-UPDATE] Payload:`, JSON.stringify(update));

            // If unreadCount becomes 0, it means it was read on the phone
            // Some updates might use 'unreadCount: null' to signify cleared, or '0'
            if (update.unreadCount === 0 || update.unreadCount === null) {
                const jid = update.id;
                console.log(`👁️ [SYNC-READ] Chat ${jid} marked as read on Phone`);

                if (!jid) continue;

                try {
                    // Find conversation by JID (either LID or Phone)
                    // Note: This requires reverse lookup or searching by patient phone
                    let phone = jid.split('@')[0];
                    // Clean phone
                    phone = phone.replace(/\D/g, '');

                    // Find patient
                    const patient = await prisma.patient.findFirst({
                        where: {
                            OR: [
                                { lid: jid },
                                { phone: { contains: phone.slice(-8) } } // Loose match
                            ]
                        }
                    });

                    if (patient) {
                        const conversation = await prisma.conversation.findFirst({
                            where: { patientId: patient.id, channel: 'whatsapp' }
                        });

                        if (conversation) {
                            // Mark all messages as read
                            await prisma.conversationMessage.updateMany({
                                where: {
                                    conversationId: conversation.id,
                                    status: { not: 'read' },
                                    sender: 'patient' // Only incoming messages need to be marked read
                                },
                                data: { status: 'read' }
                            });

                            // Reset conversation unread count
                            await prisma.conversation.update({
                                where: { id: conversation.id },
                                data: { unreadCount: 0 }
                            });
                            console.log(`✅ [SYNC-READ] Local conversation ${conversation.id} marked as read`);
                        }
                    }
                } catch (e) {
                    console.error('Error syncing read status:', e);
                }
            }
        }
    }

    private async onBaileysMessageUpdate(updates: any[]) {
        for (const update of updates) {
            // update.update.status === 3 (READ) or 4 (PLAYED)
            // update.key
            if (update.update?.status >= 3) {
                const id = update.key.id;
                console.log(`👁️ [READ-RECEIPT] Message ${id?.slice(-5)} was read/played`);

                try {
                    await prisma.conversationMessage.updateMany({
                        where: { externalId: id },
                        data: { status: 'read' }
                    });
                } catch (e) {
                    // ignore if not found
                }
            }
        }
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


        // --- FAMILY REDIRECTION LOGIC ---
        // Check if patient has a representative who should receive notifications
        const relationship = await prisma.patientRelationship.findFirst({
            where: {
                patientId: params.patientId,
                receivesNotifications: true
            },
            include: { relative: true }
        });

        let targetPhone = patient.phone;
        let isRedirected = false;

        if (relationship?.relative?.phone) {
            targetPhone = relationship.relative.phone;
            isRedirected = true;
            console.log(`🔀 [REDIRECT] Redirecting message for ${patient.firstName} to Representative: ${relationship.relative.firstName} (${targetPhone})`);
        }
        // --------------------------------

        // Send via provider
        const result = await activeProvider.sendMessage({
            to: targetPhone, // Use redirected phone
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


        // --- FAMILY REDIRECTION LOGIC ---
        // Check if patient has a representative who should receive notifications
        const relationship = await prisma.patientRelationship.findFirst({
            where: {
                patientId: params.patientId,
                receivesNotifications: true
            },
            include: { relative: true }
        });

        let targetPhone = patient.phone;
        let isRedirected = false;

        if (relationship?.relative?.phone) {
            targetPhone = relationship.relative.phone;
            isRedirected = true;
            console.log(`🔀 [REDIRECT] Redirecting REMINDER for ${patient.id} to Representative: ${relationship.relative.firstName} (${targetPhone})`);
        }
        // --------------------------------

        // Send via Twilio (Official Templates)
        const result = await this.twilioProvider.sendMessage({
            to: targetPhone, // Use redirected phone
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
     * Mark remote messages as read on the Provider (WhatsApp/Twilio)
     */
    async markMessagesAsRead(conversationId: string) {
        // 1. Get unread messages for this conversation
        const unreadMessages = await prisma.conversationMessage.findMany({
            where: {
                conversationId: conversationId,
                sender: 'patient',
                status: { not: 'read' },
                externalId: { not: null }
            },
            take: 20 // Batch limit to avoid rate limits
        });

        if (unreadMessages.length === 0) return;

        console.log(`👁️ [READ-SYNC] Found ${unreadMessages.length} unread messages to sync with provider`);

        // 2. Fetch context once
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { patient: true }
        });

        if (!conversation?.patient?.phone) {
            console.warn('Cannot sync read status: Patient has no phone/context');
            return;
        }

        // 3. Determine JID
        // FORCE using Phone JID (@s.whatsapp.net) for Read Receipts to ensure they reflect on the physical device.
        let phone = conversation.patient.phone.replace(/\D/g, '');
        let remoteJid = `${phone}@s.whatsapp.net`;

        // Fallback: If we absolutely don't have a phone (unlikely given checks), use LID as last resort
        if (!phone && conversation.patient.lid) {
            remoteJid = conversation.patient.lid;
        }

        // 4. Mark each as read
        for (const msg of unreadMessages) {
            if (msg.provider === 'baileys' && msg.externalId) {
                const key = {
                    remoteJid: remoteJid,
                    id: msg.externalId,
                    fromMe: false // Incoming message
                };

                // Debug log
                console.log(`👁️ [READ-CMD] Marking ${msg.externalId} as read. JID: ${remoteJid}`);
                try {
                    await this.baileysProvider.markAsRead(key, false);

                    // Update local DB status to 'read' to prevent re-sending
                    await prisma.conversationMessage.update({
                        where: { id: msg.id },
                        data: { status: 'read' }
                    });
                } catch (e) {
                    console.error(`❌ [READ-FAIL] Failed to mark ${msg.externalId} as read:`, e);
                }
            }
        }
    }

    /**
     * Handle incoming messages from Baileys (Official WhatsApp)
     */
    private async onBaileysMessage(m: any) {
        try {
            const { messages, type } = m;
            console.log(`📡 [WA-EVENT] ${type} (${messages?.length || 0} msgs)`);

            if (!messages) return;

            if (type === 'append') {
                console.log(`📚 [HISTORY] Processing history sync batch (${messages?.length} msgs)...`);
                // We allow processing to populate DB
            }

            for (const msg of messages) {
                const remoteJid = msg.key.remoteJid;
                const fromMe = msg.key.fromMe;

                // Check Timestamp for stale messages (Safety net for 'notify' type that is actually old)
                let msgTs = 0;
                if (msg.messageTimestamp) {
                    msgTs = typeof msg.messageTimestamp === 'number'
                        ? msg.messageTimestamp
                        : (msg.messageTimestamp as any).toNumber ? (msg.messageTimestamp as any).toNumber() : Number(msg.messageTimestamp);
                }

                if (msgTs > 0) {
                    const msgTime = new Date(msgTs * 1000);
                    const now = new Date();
                    const diffMs = now.getTime() - msgTime.getTime();
                    const diffSeconds = (diffMs / 1000).toFixed(1);
                    console.log(`⏱️ [LATENCY] Msg Time: ${msgTime.toLocaleTimeString()} | Now: ${now.toLocaleTimeString()} | Lag: ${diffSeconds}s`);

                    const diffHours = (diffMs) / (1000 * 60 * 60);

                    // REMOVED 24h skip to allow History Sync ("append" type) and full restoration
                    if (diffHours > 24 && type === 'notify') {
                        // Optional: we can still log it as Old but we SHOULD save it if we want persistent history
                        console.log(`🕰️ [OLD-MSG] Processing old message from ${msgTime.toISOString()} (${diffHours.toFixed(1)}h old)`);
                    }
                }

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
                    // Unwrap common wrappers
                    if (m.ephemeralMessage) return extractContent(m.ephemeralMessage.message);
                    if (m.viewOnceMessage) return extractContent(m.viewOnceMessage.message);
                    if (m.viewOnceMessageV2) return extractContent(m.viewOnceMessageV2.message);
                    if (m.documentWithCaptionMessage) return extractContent(m.documentWithCaptionMessage.message);

                    const actualMsg = m.message || m;

                    return actualMsg.conversation ||
                        actualMsg.extendedTextMessage?.text ||
                        actualMsg.imageMessage?.caption ||
                        actualMsg.videoMessage?.caption ||
                        actualMsg.documentMessage?.caption ||
                        actualMsg.templateButtonReplyMessage?.selectedDisplayText ||
                        actualMsg.buttonsResponseMessage?.selectedDisplayText ||
                        actualMsg.listResponseMessage?.title ||
                        actualMsg.interactiveMessage?.body?.text || // Interactive/Button messages
                        (actualMsg.stickerMessage ? '(Sticker)' : '') ||
                        (actualMsg.imageMessage ? '(Imagen)' : '') ||
                        (actualMsg.audioMessage ? '(Audio)' : '') ||
                        (actualMsg.videoMessage ? '(Video)' : '') ||
                        (actualMsg.documentMessage ? '(Documento)' : '') ||
                        (actualMsg.locationMessage ? '(Ubicación)' : '') ||
                        (actualMsg.contactMessage ? '(Contacto)' : '') ||
                        (actualMsg.contactsArrayMessage ? '(Lista de Contactos)' : '') ||
                        (actualMsg.reactionMessage ? `(Reacción: ${actualMsg.reactionMessage.text})` : '') ||
                        (actualMsg.pollCreationMessage ? `(Encuesta: ${actualMsg.pollCreationMessage.name})` : '') ||
                        (actualMsg.protocolMessage ? '' : '') || // Skip protocol messages text
                        '';
                };

                // Skip pure protocol messages (like history sync end, or simple edits without context)
                if (msg.message?.protocolMessage) {
                    console.log('⏭️ [SKIP] Protocol/System Message');
                    continue;
                }

                // Skip reaction messages (optional, or save them as text)
                if (msg.message?.reactionMessage) {
                    // For now, let's skip reactions to clear up the UI, 
                    // or we can allow them if the user wants to see emojis. 
                    // Given the "Empty Bubble" complaint, let's log and maybe skip if no text.
                    // extractContent handles it above, so it won't be empty if we decide to keep.
                }

                let content = extractContent(msg.message);
                const msgType = this.getBaileysMessageType(msg.message);

                // --- VALIDATION BEFORE CREATION ---
                // Determine if we should process this message at all
                let mediaUrl = undefined;
                let downloadedContent = content;

                // Pre-check for media types to see if we can download them later (we don't download yet to save time if we skip)
                const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(msgType);

                // If it's not media and has no text content, it's likely junk/protocol
                if (!content && !isMedia) {
                    console.log('⚠️ [SKIP-EMPTY] Message has no content and no media. Skipping creation.');
                    continue;
                }
                // ----------------------------------

                // Phone number digits
                let phoneDigits = remoteJid.split('@')[0].replace(/\D/g, '');

                // ... (existing Ignore Self logic) ...
                const myConnectedPhone = this.baileysProvider.getCurrentPhone();
                if (myConnectedPhone && (phoneDigits === myConnectedPhone || phoneDigits.endsWith(myConnectedPhone))) {
                    console.log(`🛑 [IGNORE-SELF] Skipping message from connected number: ${phoneDigits}`);
                    continue;
                }

                // ... (LID and Patient Logic remains the same) ...
                // [Insert the existing Patient Lookup Logic here? No, tool replaces blocks. I must respect the flow.]
                // The tool replaces a chunk. I need to be careful to match context.
                // I will target the existing extraction block and extend it.

                // ... (Skip to extraction usage) ...


                // IGNORE SELF (DYNAMICALLY)
                // (Already handled above) removed duplicate logic


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
                    // REMOVED: if (fromMe) continue;
                    // We WANT to capture outgoing messages to new numbers (Leads initiated from Phone)

                    console.log(`🆕 [LEAD] Creating for ${phoneDigits} (Source: ${fromMe ? 'Phone-Outgoing' : 'Incoming'})`);
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

                // Media Handling
                // (mediaUrl and downloadedContent are already declared above)

                if (['image', 'video', 'audio', 'document', 'sticker'].includes(msgType)) {
                    console.log(`📥 [MEDIA] Downloading ${msgType}...`);
                    try {
                        const buffer = await this.baileysProvider.downloadMedia(msg.message);
                        if (buffer) {
                            const uploadDir = path.join(process.env.UPLOAD_DIR || 'public/uploads', 'whatsapp');
                            if (!fs.existsSync(uploadDir)) {
                                fs.mkdirSync(uploadDir, { recursive: true });
                            }

                            // Generate filename
                            const extMap: Record<string, string> = {
                                'image': 'jpg',
                                'video': 'mp4',
                                'audio': 'mp3', // WhatsApp audio is usually ogg/mp3
                                'document': 'pdf', // Default fallback
                                'sticker': 'webp'
                            };

                            // Try to detect extension accurately from mimetype if possible, otherwise simple map
                            const ext = extMap[msgType] || 'bin';
                            const fileName = `wa_${Date.now()}_${msg.key.id}.${ext}`;
                            const filePath = path.join(uploadDir, fileName);

                            fs.writeFileSync(filePath, buffer);
                            mediaUrl = `/uploads/whatsapp/${fileName}`;
                            console.log(`✅ [MEDIA] Locked & Saved: ${mediaUrl}`);

                            // Update content ref to show it's a file if empty
                            if (!downloadedContent) {
                                downloadedContent = `(Archivo Adjunto: ${msgType})`;
                            }
                        } else {
                            console.warn('⚠️ [MEDIA] Failed to download buffer');
                            // Update content to reflect failure if it was just a placeholder
                            if (!downloadedContent || downloadedContent === `(Archivo Adjunto: ${msgType})` || downloadedContent === `(${msgType})`) {
                                downloadedContent = `⚠️ Error: No se pudo descargar ${msgType}`;
                            }
                        }
                    } catch (e) {
                        console.error('❌ [MEDIA] Error processing media:', e);
                        downloadedContent = `⚠️ Error procesando ${msgType}`;
                    }
                }

                // Final Content Logic
                const finalContent = downloadedContent || (msgType === 'text' ? '' : `(Archivo: ${msgType})`);

                // (Validation already done at start)

                // Save message
                await prisma.conversationMessage.create({
                    data: {
                        conversationId: conversation.id,
                        content: finalContent,
                        type: msgType,
                        sender: fromMe ? 'clinic' : 'patient',
                        status: 'delivered',
                        externalId: msg.key.id,
                        provider: 'baileys',
                        sentAt: msgDate,
                        mediaUrl: mediaUrl // Save the URL
                    }
                });

                // Update conversation
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        lastMessageAt: new Date(),
                        // Only increment unread if it's NOT from me AND NOT history sync (append)
                        unreadCount: (fromMe || type === 'append') ? undefined : { increment: 1 }
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
