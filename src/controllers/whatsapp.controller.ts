import { Request, Response } from 'express';
import { notificationService } from '../services/notifications/NotificationService';

export const getStatus = async (req: Request, res: Response) => {
    try {
        const status = await notificationService.getBaileysStatus();
        res.json(status);
    } catch (error) {
        console.error('Error getting WhatsApp status:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
};

export const logout = async (req: Request, res: Response) => {
    try {
        await notificationService.logoutBaileys();
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Error logging out:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
};

export const reconnect = async (req: Request, res: Response) => {
    try {
        // Just calling initialize again should trigger reconnect logic if disconnected
        await notificationService.initialize();
        res.json({ success: true, message: 'Reconnection initiated' });
    } catch (error) {
        console.error('Error reconnecting:', error);
        res.status(500).json({ error: 'Failed to reconnect' });
    }
};
