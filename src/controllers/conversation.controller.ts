import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { notificationService } from '../services/notifications/NotificationService';

/**
 * Get all conversations with patient info and last message
 */
export const getConversations = async (req: Request, res: Response) => {
    try {
        const conversations = await prisma.conversation.findMany({
            include: {
                patient: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        insurance: true,
                        appointments: {
                            where: {
                                date: { gte: new Date() },
                                status: { notIn: ['CANCELLED', 'NO_SHOW'] }
                            },
                            orderBy: { date: 'asc' },
                            take: 1
                        }
                    }
                },
                messages: {
                    orderBy: { sentAt: 'desc' },
                    take: 1
                },
                tags: true
            },
            orderBy: { lastMessageAt: 'desc' }
        });

        const formatted = conversations.map(conv => ({
            id: conv.id,
            patientId: conv.patient.id,
            patientName: `${conv.patient.firstName} ${conv.patient.lastName}`,
            patientPhone: conv.patient.phone,
            channel: conv.channel,
            status: conv.status,
            unreadCount: conv.unreadCount,
            lastMessage: conv.messages[0] || null,
            tags: conv.tags.map(t => t.tag),
            // Additional context (for UI sidebar)
            nextAppointment: conv.patient.appointments[0]?.date.toISOString() || null,
            insurance: conv.patient.insurance?.name || 'Particular',
            lastVisit: null,
            outstandingBalance: null
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
};

/**
 * Get all messages for a specific conversation
 */
export const getConversationMessages = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;

        const messages = await prisma.conversationMessage.findMany({
            where: { conversationId: id },
            orderBy: { sentAt: 'asc' },
            include: { user: { select: { fullName: true } } }
        });

        // Transform to match frontend Message type
        const formatted = messages.map(msg => ({
            id: msg.id,
            content: msg.content,
            type: msg.type,
            sender: msg.sender === 'clinic' ? 'me' : 'patient',
            senderName: msg.user?.fullName, // For audit
            timestamp: msg.sentAt.toISOString(),
            status: msg.status,
            mediaUrl: msg.mediaUrl,
            mediaType: msg.mediaType,
            mediaSize: msg.mediaSize,
            provider: msg.provider
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
};

/**
 * Send a message in a conversation
 */
export const sendMessage = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { content, mediaUrl } = req.body;

        if (!content && !mediaUrl) {
            return res.status(400).json({ error: 'Message content or media URL required' });
        }

        const conversation = await prisma.conversation.findUnique({
            where: { id },
            include: { patient: true }
        });

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const result = await notificationService.sendMessage({
            patientId: conversation.patientId,
            message: content || '(Archivo adjunto)',
            mediaUrl,
            userId: (req as any).user?.userId || (req as any).user?.id
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId });
    } catch (error: any) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message || 'Failed to send message' });
    }
};

/**
 * Mark conversation as read (reset unread count)
 */
export const markAsRead = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;

        await prisma.conversation.update({
            where: { id },
            data: { unreadCount: 0 }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
};
/**
 * Update conversation status (open/closed)
 */
export const updateStatus = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { status } = req.body;

        if (!['open', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be open or closed' });
        }

        await prisma.conversation.update({
            where: { id },
            data: { status }
        });

        res.json({ success: true, status });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
};
