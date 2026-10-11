import { IWhatsAppProvider } from './IWhatsAppProvider';
import makeWASocket, {
    DisconnectReason,
    WASocket,
    ConnectionState,
    proto,
    Contact,
    BaileysEventMap,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import { usePrismaAuthState } from './usePrismaAuthState';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

export class BaileysProvider implements IWhatsAppProvider {
    name = 'baileys';
    private sock: WASocket | null = null;
    private lidToPhone: Map<string, string> = new Map();
    private lidMapPath = path.join(process.env.UPLOAD_DIR || path.resolve('public/uploads'), 'baileys_lid_map.json');
    private qrCode: string | null = null;
    private status: 'connected' | 'connecting' | 'disconnected' | 'waiting_qr' = 'disconnected';
    // Lazy TTL expiry avoids a cache interval retaining unused providers.
    private msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 0 });
    private enabled = false;
    private generation = 0;
    private connectionTask: Promise<void> | null = null;
    private stopTask: Promise<void> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private socketCleanup: (() => void) | null = null;
    private recoveryInstalled = false;

    private readonly recoverCryptoCrash = (err: Error) => {
        if (!err.message.includes('Unsupported state or unable to authenticate data')) {
            console.error('Uncaught Exception:', err);
            process.exit(1);
        }
        if (!this.enabled || this.reconnectTimer) return;
        console.error('WhatsApp crypto error: reconnecting without deleting credentials', err);
        this.retireSocket();
        this.connectionTask = null;
        this.msgRetryCounterCache.flushAll();
        this.scheduleReconnect(5000);
    };

    private installRecoveryHandler() {
        if (this.recoveryInstalled) return;
        process.on('uncaughtException', this.recoverCryptoCrash);
        this.recoveryInstalled = true;
    }

    private cancelReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private retireSocket(): WASocket | null {
        const socket = this.sock;
        this.sock = null;
        this.generation++;
        this.socketCleanup?.();
        this.socketCleanup = null;
        this.status = 'disconnected';
        this.qrCode = null;
        if (socket) {
            try { socket.end(undefined); }
            catch (err) { console.error('Error closing WhatsApp socket:', err); }
        }
        return socket;
    }

    private scheduleReconnect(minimumDelay = 2000) {
        if (!this.enabled || this.reconnectTimer) return;
        const delay = Math.max(minimumDelay, Math.min(60000, 2000 * 2 ** Math.min(this.reconnectAttempt++, 5)));
        const generation = this.generation;
        console.log(`WhatsApp reconnect scheduled in ${delay}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.enabled || this.generation !== generation) return;
            void this.connectToWhatsApp().catch(err => console.error('WhatsApp reconnect failed:', err));
        }, delay);
        this.reconnectTimer.unref();
    }

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
        if (this.stopTask) await this.stopTask;
        this.enabled = true;
        this.installRecoveryHandler();
        if (this.sock || this.connectionTask) {
            await this.connectionTask;
            return;
        }
        // Explicit reconnect can resume immediately; repeated clicks share the same task.
        this.cancelReconnect();
        this.reconnectAttempt = 0;
        await this.connectToWhatsApp();
    }

    private connectToWhatsApp(): Promise<void> {
        if (!this.enabled || this.sock) return Promise.resolve();
        if (this.connectionTask) return this.connectionTask;
        const generation = ++this.generation;
        this.status = 'connecting';
        const task = this.openSocket(generation).catch(err => {
            if (this.enabled && this.generation === generation) {
                this.retireSocket();
                this.scheduleReconnect();
            }
            throw err;
        }).finally(() => {
            if (this.connectionTask === task) this.connectionTask = null;
        });
        this.connectionTask = task;
        return task;
    }

    private async openSocket(generation: number) {
        const { state, saveCreds } = await usePrismaAuthState();
        if (!this.enabled || this.generation !== generation) return;
        const sock = makeWASocket({
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
            emitOwnEvents: true, // Explicitly enable processing of own messages (Mirroring)
            shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid.includes('status@broadcast'), // Ignore Status Updates to prevent backlog/decrypt errors
        });

        this.sock = sock;
        const isCurrent = () => this.enabled && this.generation === generation && this.sock === sock;
        const cleanups: (() => void)[] = [];
        const on = <K extends keyof BaileysEventMap>(event: K, handler: (value: BaileysEventMap[K]) => void) => {
            const guarded = (value: BaileysEventMap[K]) => {
                if (isCurrent()) handler(value);
            };
            sock.ev.on(event, guarded);
            cleanups.push(() => sock.ev.off(event, guarded));
        };
        this.socketCleanup = () => cleanups.forEach(cleanup => cleanup());

        on('creds.update', () => {
            void saveCreds().catch(err => console.error('Error saving WhatsApp credentials:', err));
        });

        on('connection.update', (update: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                this.status = 'waiting_qr';
                this.qrCode = qr;
                console.log('Scannable QR Code generated');
            }
            if (connection === 'close') {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                console.log(`WhatsApp connection closed. Reason: ${reason}`);
                if (reason === DisconnectReason.loggedOut || reason === 401) {
                    // Only a genuine logout or an explicit user action clears credentials.
                    void this.logout().catch(err => console.error('WhatsApp logout failed:', err));
                } else {
                    this.retireSocket();
                    this.scheduleReconnect();
                }
            } else if (connection === 'open') {
                this.status = 'connected';
                this.qrCode = null;
                this.reconnectAttempt = 0;
                this.cancelReconnect();
                console.log('Opened connection to WhatsApp!');
            }
        });

        // Listen for contacts to build LID map
        on('contacts.upsert', (contacts: Contact[]) => {
            let changed = false;
            for (const contact of contacts) {
                if (contact.lid && contact.id) { // contact.id is usually the phone number JID
                    this.lidToPhone.set(contact.lid, contact.id.split('@')[0]);
                    changed = true;
                }
            }
            if (changed) this.saveLidMap();
        });

        on('contacts.update', (updates: Partial<Contact>[]) => {
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
        on('messages.upsert', async (m) => {
            console.log('📬 BaileysProvider: Raw messages.upsert received', JSON.stringify({ type: m.type, count: m.messages?.length, firstMsgKey: m.messages?.[0]?.key }));
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
        on('messages.update', async (updates) => {
            console.log('📬 BaileysProvider: messages.update', updates.length);
            try { await this.messageUpdateHandler?.(updates); }
            catch (err) { console.error('Error handling WhatsApp message updates:', err); }
        });

        // Listen for chat updates (e.g. Unread count cleared on phone)
        on('chats.update', async (updates) => {
            console.log('📬 BaileysProvider: chats.update', updates.length);
            try { await this.chatUpdateHandler?.(updates); }
            catch (err) { console.error('Error handling WhatsApp chat updates:', err); }
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

    private stop(logout: boolean): Promise<void> {
        if (this.stopTask) return this.stopTask;
        this.enabled = false;
        this.cancelReconnect();
        this.connectionTask = null;
        if (this.recoveryInstalled) {
            process.removeListener('uncaughtException', this.recoverCryptoCrash);
            this.recoveryInstalled = false;
        }
        // Detach our callbacks before logout/end can emit more connection events.
        const socket = this.sock;
        this.sock = null;
        this.generation++;
        this.socketCleanup?.();
        this.socketCleanup = null;
        this.status = 'disconnected';
        this.qrCode = null;
        this.reconnectAttempt = 0;
        this.msgRetryCounterCache.flushAll();
        const task = (async () => {
            try {
                if (logout && socket) {
                    try { await socket.logout(); }
                    catch (err) { console.error('Socket logout failed:', err); }
                }
            } finally {
                try { socket?.end(undefined); }
                catch (err) { console.error('Error closing WhatsApp socket:', err); }
            }
            if (logout) {
                const { prisma } = await import('../../../lib/prisma');
                await prisma.baileysSession.deleteMany({});
                console.log('WhatsApp logged out; credentials cleared.');
            }
        })().finally(() => {
            if (this.stopTask === task) this.stopTask = null;
        });
        this.stopTask = task;
        return task;
    }

    async disconnect(): Promise<void> {
        await this.stop(false);
    }

    async logout(): Promise<void> {
        await this.stop(true);
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
