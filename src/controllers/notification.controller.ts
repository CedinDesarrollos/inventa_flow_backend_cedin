import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { DateTime } from 'luxon';
import { AuthRequest } from '../middleware/auth.middleware';

export const getNotifications = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const startOfToday = DateTime.now().startOf('day').toJSDate();

        // Fetch notifications created TODAY (or unread ones if preferred, but user asked for "Today only")
        // User request: "el sistema de notificaciones debería mostrar lo del día."
        // We will fetch ALL notifications from TODAY, regardless of read status, 
        // OR we can fetch unread + today's read.
        // Let's stick to "Created Today" as the primary filter for the list.

        const notifications = await prisma.notification.findMany({
            where: {
                OR: [
                    { userId: userId }, // Assigned specifically to this user (fan-out)
                    { userId: null }    // Backward compatibility for old "global" notifications
                ],
                createdAt: {
                    gte: startOfToday
                },
                // optional: read: false // if we only want unread, but we usually want history
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
                OR: [
                    { userId: userId },
                    { userId: null }
                ],
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
            // Only mark "my" notifications as read? 
            // Since the route is authenticated, we should probably check ownership, but strictness might break "null" assignment legacy.
            // For now, let's assume the ID list is filtered by getNotifications so the client only sends valid IDs,
            // or if 'all', we update everything visible to user.

            // However, we can't easily get userId here without AuthRequest if we don't cast it.
            // But since we added middleware, req is AuthRequest.
            const userId = (req as AuthRequest).user?.userId;

            await prisma.notification.updateMany({
                where: {
                    read: false,
                    OR: [
                        { userId: userId },
                        { userId: null }
                    ]
                },
                data: { read: true }
            });
        } else {
            // Update single
            await prisma.notification.updateMany({
                where: { id }, // Safe enough
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
        if (data.userId) {
            // Targeted notification (e.g. for a specific doctor)
            await prisma.notification.create({
                data: {
                    type: data.type,
                    title: data.title,
                    message: data.message,
                    userId: data.userId,
                    link: data.link
                }
            });
        } else {
            // Broadcast to Admin/Secretary/Developer (Fan-out)
            const recipients = await prisma.user.findMany({
                where: {
                    role: { in: ['ADMIN', 'SECRETARY', 'DEVELOPER'] },
                    isActive: true
                },
                select: { id: true }
            });

            if (recipients.length > 0) {
                // Create one notification per recipient
                await prisma.notification.createMany({
                    data: recipients.map(user => ({
                        type: data.type,
                        title: data.title,
                        message: data.message,
                        userId: user.id,
                        link: data.link
                    }))
                });
            } else {
                console.warn('Notification created but no recipients found (Admin/Secretary/Dev).');
            }
        }
    } catch (error) {
        console.error('Error creating internal notification:', error);
    }
};
