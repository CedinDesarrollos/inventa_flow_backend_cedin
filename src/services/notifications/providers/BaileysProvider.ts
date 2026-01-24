import { IWhatsAppProvider } from './IWhatsAppProvider';
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    WASocket,
    ConnectionState,
    proto,
    Contact,
    Browsers
} from '@whiskeysockets/baileys';
// @ts-ignore - store export varies by version
import makeInMemoryStore from '@whiskeysockets/baileys/lib/Store/make-in-memory-store';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

export class BaileysProvider implements IWhatsAppProvider {
    name = 'baileys';
    private sock: WASocket | null = null;
    private store: any;
    private qrCode: string | null = null;
    private status: 'connected' | 'connecting' | 'disconnected' | 'waiting_qr' = 'disconnected';
    /**
     * Resolve LID to Phone Number using the Store
     */
    async getPhoneNumberFromLid(lid: string): Promise<string | null> {
        if (!this.store) return null;
        try {
            // Remove suffix if present to match key
            const id = lid.includes('@') ? lid : `${lid}@lid`;

            // Search in contacts
            // Store structure: contacts = { [jid]: { id, lid, notify, ... } }
            // If we have an LID, we're looking for the contact that has this LID
            // OR if the input IS an LID, we want the 'id' (phone JID)

            // 1. Check if we have a contact with this ID directly (unlikely if it's an LID key not mapped)
            const contact = this.store.contacts[id];
            if (contact && contact.id && contact.id.endsWith('@s.whatsapp.net')) {
                return contact.id.split('@')[0];
            }

            // 2. Iterate to find match
            const contacts = this.store.contacts;
            for (const key in contacts) {
                const c = contacts[key];
                if (c.lid === lid || c.id === lid) {
                    // Found it! Return the phone JID (usually the key or stored in .id)
                    // If the key is phone JID
                    if (key.endsWith('@s.whatsapp.net')) return key.split('@')[0];
                    if (c.id?.endsWith('@s.whatsapp.net')) return c.id.split('@')[0];
                }
            }
        } catch (err) {
            console.error('Error resolving LID', err);
        }
        return null;
    }

    private authDir = process.env.BAILEYS_AUTH_DIR ||
        path.join(process.env.UPLOAD_DIR || path.resolve('public/uploads'), 'baileys_auth_info');
    private messageHandler: ((msg: any) => void) | null = null;

    setMessageHandler(handler: (msg: any) => void) {
        this.messageHandler = handler;
    }

    constructor() {
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
        // Initialize store
        try {
            this.store = makeInMemoryStore({});
            // Read from file if exists (optional persistence)
            // this.store.readFromFile('./baileys_store_multi.json')
        } catch (e) {
            console.error('Failed to create InMemoryStore', e);
        }
    }

    async initialize(): Promise<void> {
        await this.connectToWhatsApp();
    }

    private async connectToWhatsApp() {
        this.status = 'connecting';
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: Browsers.macOS('Desktop'),
            getMessage: async (key) => {
                if (this.store) {
                    const msg = await this.store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                }
                return proto.Message.fromObject({})
            }
        });

        // Bind store
        if (this.store) {
            this.store.bind(this.sock.ev);
        }

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.status = 'waiting_qr';
                this.qrCode = qr;
                console.log('Scannable QR Code generated');
            }

            if (connection === 'close') {
                this.status = 'disconnected';
                this.qrCode = null;
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
                if (shouldReconnect) {
                    this.connectToWhatsApp();
                } else {
                    console.log('Connection closed. You are logged out.');
                    // Optionally clear auth folder here if logged out
                }
            } else if (connection === 'open') {
                this.status = 'connected';
                this.qrCode = null;
                console.log('Opened connection to WhatsApp!');
            }
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
            await this.sock?.logout();
            this.status = 'disconnected';
            // Clean up auth dir
            if (fs.existsSync(this.authDir)) {
                fs.rmSync(this.authDir, { recursive: true, force: true });
            }
        } catch (err) {
            console.error('Error locking out', err);
        }
    }
}
