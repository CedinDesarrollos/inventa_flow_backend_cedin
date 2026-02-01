import { IWhatsAppProvider } from './IWhatsAppProvider';
import makeWASocket, {
    DisconnectReason,
    WASocket,
    ConnectionState,
    proto,
    Contact,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import { usePrismaAuthState } from '../../../config/baileys-auth';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

export class BaileysProvider implements IWhatsAppProvider {
    name = 'baileys';
    private sock: WASocket | null = null;
    private lidToPhone: Map<string, string> = new Map();
    private lidMapPath = path.join(process.env.UPLOAD_DIR || path.resolve('public/uploads'), 'baileys_lid_map.json');
    private qrCode: string | null = null;
    private qrCode: string | null = null;
    private status: 'connected' | 'connecting' | 'disconnected' | 'waiting_qr' = 'disconnected';
    private msgRetryCounterCache = new NodeCache();

    /**
     * Resolve LID to Phone Number using the internal Map
     */
    async getPhoneNumberFromLid(lid: string): Promise<string | null> {
        // Simple map lookup first
        if (this.lidToPhone.has(lid)) {
            return this.lidToPhone.get(lid) || null;
        }

        // Try cleaning suffix if key has one but map doesn't, or vice-versa
        const cleanLid = lid.split('@')[0];

        // Iterate for partial match
        for (const [key, val] of this.lidToPhone.entries()) {
            if (key.includes(cleanLid)) return val;
        }

        return null;
    }

    private messageHandler: ((msg: any) => void) | null = null;

    setMessageHandler(handler: (msg: any) => void) {
        this.messageHandler = handler;
    }

    constructor() {
    }

    private saveLidMap() {
        try {
            const obj = Object.fromEntries(this.lidToPhone);
            fs.writeFileSync(this.lidMapPath, JSON.stringify(obj, null, 2));
        } catch (e) {
            console.error('Failed to save LID map', e);
        }
    }

    getCurrentUserJid(): string | undefined {
        return this.sock?.user?.id;
    }

    getCurrentPhone(): string | undefined {
        const jid = this.sock?.user?.id;
        if (!jid) return undefined;
        return jid.split(':')[0].split('@')[0];
    }

    async initialize(): Promise<void> {
        await this.connectToWhatsApp();
    }

    private async connectToWhatsApp() {
        // 1. Cleanup "zombie" socket if exists
        if (this.sock) {
            try {
                this.sock.end(undefined);
                this.sock = null;
            } catch (e) {
                console.error('Error cleaning up existing socket:', e);
            }
        }

        this.status = 'connecting';
        // Use DB Auth
        const { state, saveCreds } = await usePrismaAuthState();

        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['InventaFlow', 'Chrome', '1.0.0'],
            // Improve timeouts and stability
            connectTimeoutMs: 20000, // Fail fast to let logic retry
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 15000, // Ping more often (15s)
            retryRequestDelayMs: 2000, // Retry failed requests sooner
            syncFullHistory: false, // DISABLED to prevent massive lag on reconnects
            markOnlineOnConnect: true, // Ensure we appear online
            msgRetryCounterCache: this.msgRetryCounterCache, // Essential for handling decryption errors/retries
        });

        // Listen for credentials update
        this.sock.ev.on('creds.update', saveCreds);

        // Connection update
        this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.status = 'waiting_qr';
                this.qrCode = qr;
                console.log('Scannable QR Code generated');
            }

            if (connection === 'close') {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

                // Codes that should trigger immediate internal reconnect
                const shouldReconnect =
                    reason !== DisconnectReason.loggedOut &&
                    reason !== 401; // Unauthorized

                console.log(`🔌 Connection closed. Reason: ${reason}. Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    this.status = 'disconnected';
                    this.qrCode = null;

                    // Different backoff strategies
                    // 515 = Restart Required (Common, immediate retry)
                    // 408 = Timed Out (Common, immediate retry)
                    const delay = (reason === DisconnectReason.restartRequired || reason === DisconnectReason.timedOut)
                        ? 0
                        : 2000; // 2s delay for others

                    console.log(`🔄 Reconnecting in ${delay}ms...`);
                    setTimeout(() => this.connectToWhatsApp(), delay);
                } else {
                    console.log('❌ Connection closed permanently. You are logged out or banned.');
                    this.status = 'disconnected';
                    this.qrCode = null;
                    await this.logout();
                }
            } else if (connection === 'open') {
                this.status = 'connected';
                this.qrCode = null;
                console.log('Opened connection to WhatsApp!');
            }
        });

        // Listen for contacts to build LID map
        this.sock.ev.on('contacts.upsert', (contacts: Contact[]) => {
            let changed = false;
            for (const contact of contacts) {
                if (contact.lid && contact.id) { // contact.id is usually the phone number JID
                    this.lidToPhone.set(contact.lid, contact.id.split('@')[0]);
                    changed = true;
                }
            }
            if (changed) this.saveLidMap();
        });

        this.sock.ev.on('contacts.update', (updates: Partial<Contact>[]) => {
            let changed = false;
            for (const update of updates) {
                if (update.lid && update.id) {
                    this.lidToPhone.set(update.lid, update.id.split('@')[0]);
                    changed = true;
                }
            }
            if (changed) this.saveLidMap();
        });

        // Listen for incoming messages
        this.sock.ev.on('messages.upsert', async (m) => {
            console.log('📬 BaileysProvider: Raw messages.upsert received', { type: m.type, count: m.messages?.length });
            if (this.messageHandler) {
                try {
                    await this.messageHandler(m);
                    console.log('✅ BaileysProvider: Handler finished successfully');
                } catch (handlerErr) {
                    console.error('❌ BaileysProvider: Error in message handler:', handlerErr);
                }
            } else {
                console.warn('⚠️ BaileysProvider: No message handler registered!');
            }
        });

        // Listen for message status updates (e.g. READ receipts from phone)
        this.sock.ev.on('messages.update', async (updates) => {
            console.log('📬 BaileysProvider: messages.update', updates.length);
            if (this.messageUpdateHandler) {
                await this.messageUpdateHandler(updates);
            }
        });

        // Listen for chat updates (e.g. Unread count cleared on phone)
        this.sock.ev.on('chats.update', async (updates) => {
            console.log('📬 BaileysProvider: chats.update', updates.length);
            if (this.chatUpdateHandler) {
                await this.chatUpdateHandler(updates);
            }
        });
    }

    private messageUpdateHandler: ((updates: any[]) => void) | null = null;
    setMessageUpdateHandler(handler: (updates: any[]) => void) {
        this.messageUpdateHandler = handler;
    }

    private chatUpdateHandler: ((updates: any[]) => void) | null = null;
    setChatUpdateHandler(handler: (updates: any[]) => void) {
        this.chatUpdateHandler = handler;
    }

    async markAsRead(key: any, fromMe: boolean): Promise<void> {
        if (!this.sock) return;
        try {
            await this.sock.readMessages([key]);
            console.log(`✅ Marked message ${key.id} as read on WhatsApp`);
        } catch (error) {
            console.error('Failed to mark message as read:', error);
        }
    }

    async sendMessage(params: {
        to: string;
        message: string;
        mediaUrl?: string;
        templateId?: string;
        templateParams?: Record<string, string>;
    }): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }> {
        if (!this.sock || this.status !== 'connected') {
            // Attempt generic error or try to reconnect? 
            // For now fail if not connected
            return { success: false, error: 'Baileys provider not connected' };
        }

        try {
            // Format number: remove + if present, ensure suffix
            let id = params.to.replace('+', '').replace(/\s/g, '');
            if (!id.includes('@s.whatsapp.net')) {
                id = `${id}@s.whatsapp.net`;
            }

            let sentMsg;
            if (params.mediaUrl) {
                // Determine media type simplisticly for now
                // In a real app we might fetch headers to get mime type
                const isImage = params.mediaUrl.match(/\.(jpeg|jpg|png|gif)$/i);

                if (isImage) {
                    sentMsg = await this.sock.sendMessage(id, {
                        image: { url: params.mediaUrl },
                        caption: params.message
                    });
                } else {
                    // Default to document or text if unknown
                    sentMsg = await this.sock.sendMessage(id, {
                        document: { url: params.mediaUrl },
                        mimetype: 'application/octet-stream', // Should ideally be detected
                        fileName: path.basename(params.mediaUrl),
                        caption: params.message
                    });
                }
            } else {
                sentMsg = await this.sock.sendMessage(id, { text: params.message });
            }

            return {
                success: true,
                messageId: sentMsg?.key.id || undefined
            };

        } catch (error) {
            console.error('Error sending Bailey message:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async getStatus(): Promise<{
        connected: boolean;
        status: string;
        qrCode?: string;
        number?: string;
        error?: string;
    }> {
        let qrDataUrl = undefined;
        if (this.status === 'waiting_qr' && this.qrCode) {
            try {
                qrDataUrl = await qrcode.toDataURL(this.qrCode);
            } catch (err) {
                console.error('Error generating QR data URL', err);
            }
        }

        return {
            connected: this.status === 'connected',
            status: this.status,
            qrCode: qrDataUrl,
            number: this.sock?.user?.id?.split(':')[0]?.split('@')[0]
        };
    }

    async disconnect(): Promise<void> {
        try {
            await this.sock?.end(undefined);
            this.status = 'disconnected';
        } catch (err) {
            console.error('Error disconnecting', err);
        }
    }

    async logout(): Promise<void> {
        try {
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (e) { console.error('Socket logout failed, continuing to DB wipe', e) }

                this.sock.end(undefined);
                this.sock = null;
            }
            this.status = 'disconnected';
            this.qrCode = null;

            // Clear DB Session
            console.log('Logging out: Wiping DB Credentials...');
            const { prisma } = require('../../../lib/prisma');
            await prisma.baileysSession.deleteMany({}); // Wipe all sessions on logout
            console.log('DB Credentials wiped.');

        } catch (err) {
            console.error('Error during logout process', err);
        }
    }

    async downloadMedia(message: any): Promise<Buffer | null> {
        try {
            const buffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                {
                    logger: console as any,
                    // Cast to any because the type definition can be strict vs runtime optionality
                    reuploadRequest: this.sock?.updateMediaMessage as any
                }
            );
            return buffer as Buffer;
        } catch (error) {
            console.error('Failed to download media message', error);
            return null;
        }
    }
}
