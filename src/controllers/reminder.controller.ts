import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { DateTime } from 'luxon';

/**
 * Get reminder statistics for dashboard
 */
export const getReminderStats = async (req: Request, res: Response) => {
    try {
        const { period = 'today' } = req.query;
        const timezone = 'America/Asuncion'; // TODO: Get from system settings
        const now = DateTime.now().setZone(timezone);

        let startDate: DateTime;

        switch (period) {
            case 'today':
                startDate = now.startOf('day');
                break;
            case 'week':
                startDate = now.startOf('week');
                break;
            case 'month':
                startDate = now.startOf('month');
                break;
            default:
                startDate = now.startOf('day');
        }

        // Get all reminders in period
        const reminders = await prisma.appointmentReminder.findMany({
            where: {
                createdAt: {
                    gte: startDate.toJSDate()
                }
            },
            include: {
                appointment: {
                    include: {
                        patient: true
                    }
                }
            }
        });

        // Calculate stats
        const total = reminders.length;
        const sent = reminders.filter(r => ['sent', 'delivered', 'read'].includes(r.status)).length;
        const failed = reminders.filter(r => r.status === 'failed').length;
        const pending = reminders.filter(r => r.status === 'pending').length;

        const confirmed = reminders.filter(r => r.patientResponse === 'confirmed').length;
        const cancelled = reminders.filter(r => r.patientResponse === 'cancelled').length;
        const rescheduled = reminders.filter(r => r.patientResponse === 'rescheduled').length;
        const noResponse = sent - (confirmed + cancelled + rescheduled);

        // Calculate rates
        const deliveryRate = total > 0 ? Math.round((sent / total) * 100) : 0;
        const responseRate = sent > 0 ? Math.round(((confirmed + cancelled + rescheduled) / sent) * 100) : 0;

        // Daily trends (last 30 days)
        const thirtyDaysAgo = now.minus({ days: 30 }).startOf('day');
        const dailyReminders = await prisma.appointmentReminder.findMany({
            where: {
                createdAt: {
                    gte: thirtyDaysAgo.toJSDate()
                }
            },
            select: {
                createdAt: true,
                status: true
            }
        });

        // Group by day
        const dailyTrends = [];
        for (let i = 29; i >= 0; i--) {
            const day = now.minus({ days: i }).startOf('day');
            const dayEnd = day.endOf('day');

            const dayReminders = dailyReminders.filter(r => {
                const date = DateTime.fromJSDate(r.createdAt).setZone(timezone);
                return date >= day && date <= dayEnd;
            });

            dailyTrends.push({
                date: day.toFormat('yyyy-MM-dd'),
                sent: dayReminders.filter(r => ['sent', 'delivered', 'read'].includes(r.status)).length,
                failed: dayReminders.filter(r => r.status === 'failed').length
            });
        }

        res.json({
            summary: {
                total,
                sent,
                failed,
                pending,
                deliveryRate,
                responseRate
            },
            responses: {
                confirmed,
                cancelled,
                rescheduled,
                noResponse
            },
            dailyTrends
        });

    } catch (error: any) {
        console.error('Error getting reminder stats:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get reminder error logs
 */
export const getReminderLogs = async (req: Request, res: Response) => {
    try {
        const { limit = 50, status = 'failed' } = req.query;

        const logs = await prisma.appointmentReminder.findMany({
            where: {
                status: status as string
            },
            include: {
                appointment: {
                    include: {
                        patient: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: Number(limit)
        });

        const formatted = logs.map(log => ({
            id: log.id,
            appointmentId: log.appointmentId,
            patientName: `${log.appointment.patient.firstName} ${log.appointment.patient.lastName}`,
            appointmentDate: log.appointment.date,
            status: log.status,
            errorMessage: log.errorMessage,
            retryCount: log.retryCount,
            createdAt: log.createdAt,
            sentAt: log.sentAt
        }));

        res.json(formatted);

    } catch (error: any) {
        console.error('Error getting reminder logs:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Manually trigger reminder sending (for testing)
 */
export const sendPendingReminders = async (req: Request, res: Response) => {
    try {
        const { ReminderService } = await import('../services/reminders/ReminderService');
        const reminderService = new ReminderService();

        await reminderService.processReminders();

        res.json({ message: 'Reminders processed successfully' });
    } catch (error: any) {
        console.error('Error sending reminders:', error);
        res.status(500).json({ error: error.message });
    }
};
