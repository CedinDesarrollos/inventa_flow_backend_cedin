import twilio from 'twilio';
import { IWhatsAppProvider } from './IWhatsAppProvider';

export class TwilioProvider implements IWhatsAppProvider {
    name = 'twilio';
    private client: any;

    async initialize() {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            throw new Error('Twilio credentials not configured in environment variables');
        }

        this.client = twilio(accountSid, authToken);
        console.log('✅ Twilio provider initialized');
    }

    async sendMessage(params: {
        to: string;
        message: string;
        mediaUrl?: string;
        templateId?: string;
        templateParams?: Record<string, string>;
    }) {
        const { to, message, mediaUrl, templateId, templateParams } = params;

        const messageData: any = {
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${to}`,
        };

        if (templateId) {
            // Use approved template (for proactive messages)
            messageData.contentSid = templateId;
            messageData.contentVariables = JSON.stringify(templateParams || {});
        } else {
            // Free-form message (only works within 24h window)
            messageData.body = message;
            if (mediaUrl) {
                // If mediaUrl is local, convert to full URL
                let fullMediaUrl = mediaUrl.startsWith('http')
                    ? mediaUrl
                    : `${process.env.API_URL || 'http://localhost:3000'}${mediaUrl}`;

                // FORCE HTTPS if we are on a production-like domain (not localhost)
                // This fixes issues where req.protocol might be http behind proxy but Twilio requires https
                if (fullMediaUrl.startsWith('http:') && !fullMediaUrl.includes('localhost')) {
                    fullMediaUrl = fullMediaUrl.replace('http:', 'https:');
                }

                messageData.mediaUrl = [fullMediaUrl];
            }
        }

        try {
            console.log('🚀 Sending to Twilio:', JSON.stringify(messageData, null, 2));
            const result = await this.client.messages.create(messageData);
            console.log(`✅ Message sent via Twilio: ${result.sid}`);
            return {
                success: true,
                messageId: result.sid
            };
        } catch (error: any) {
            console.error('❌ Twilio send error Details:', {
                code: error.code,
                message: error.message,
                moreInfo: error.moreInfo,
                status: error.status
            });
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getStatus() {
        try {
            await this.client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
            return { connected: true };
        } catch (error: any) {
            return { connected: false, error: error.message };
        }
    }

    async disconnect() {
        // Twilio doesn't require explicit disconnect
        console.log('✅ Twilio provider disconnected');
    }
}
