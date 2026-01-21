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
                const fullMediaUrl = mediaUrl.startsWith('http')
                    ? mediaUrl
                    : `${process.env.API_URL || 'http://localhost:3000'}${mediaUrl}`;
                messageData.mediaUrl = [fullMediaUrl];
            }
        }

        try {
            const result = await this.client.messages.create(messageData);
            console.log(`✅ Message sent via Twilio: ${result.sid}`);
            return {
                success: true,
                messageId: result.sid
            };
        } catch (error: any) {
            console.error('❌ Twilio send error:', error.message);
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
