import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { DateTime } from 'luxon';

export const getNotifications = async (req: Request, res: Response) => {
    try {
        const startOfToday = DateTime.now().startOf('day').toJSDate();

        // Fetch notifications created TODAY (or unread ones if preferred, but user asked for "Today only")
        // User request: "el sistema de notificaciones debería mostrar lo del día."
        // We will fetch ALL notifications from TODAY, regardless of read status, 
        // OR we can fetch unread + today's read.
        // Let's stick to "Created Today" as the primary filter for the list.

        const notifications = await prisma.notification.findMany({
            where: {
                createdAt: {
                    gte: startOfToday
                },
                read: false
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 50
        });

        // Also count unreads (global or just today? usually global unread count is expected, but if we only show today's...)
        // If we only show today's, we should probably only count today's unreads to match the list.
        const unreadCount = await prisma.notification.count({
            where: {
                read: false,
                createdAt: {
                    gte: startOfToday
                }
            }
        });

        res.json({ notifications, unreadCount });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

export const markAsRead = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string }; // Type assertion or string validation

        if (id === 'all') {
            await prisma.notification.updateMany({
                where: { read: false }, // Mark ALL unread as read? Or just today's? safely mark all unread.
                data: { read: true }
            });
        } else {
            await prisma.notification.update({
                where: { id },
                data: { read: true }
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notifications' });
    }
};

/**
 * Internal helper to create notifications
 */
export const createNotification = async (data: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    userId?: string;
    link?: string;
}) => {
    try {
        await prisma.notification.create({
            data: {
                type: data.type,
                title: data.title,
                message: data.message,
                userId: data.userId,
                link: data.link
            }
        });
    } catch (error) {
        console.error('Error creating internal notification:', error);
    }
};
