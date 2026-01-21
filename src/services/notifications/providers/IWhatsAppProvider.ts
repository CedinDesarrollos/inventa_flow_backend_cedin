export interface IWhatsAppProvider {
    name: string;

    initialize(): Promise<void>;

    sendMessage(params: {
        to: string;           // +595981234567
        message: string;
        mediaUrl?: string;    // For sending attachments
        templateId?: string;  // For Twilio templates
        templateParams?: Record<string, string>;
    }): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;

    getStatus(): Promise<{
        connected: boolean;
        error?: string;
    }>;

    disconnect(): Promise<void>;
}
