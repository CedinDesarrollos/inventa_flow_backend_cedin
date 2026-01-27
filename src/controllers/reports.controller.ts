import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { subMonths, startOfDay, endOfDay, isValid } from 'date-fns';
import { AppointmentStatus } from '@prisma/client';

const CLINIC_CONFIG_KEY = 'CLINIC_CONFIG';

export const getDashboardKpis = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, branchId, doctorId } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required' });
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));

        if (!isValid(start) || !isValid(end)) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        // Adjust dates to cover full day if time is not provided/zeroed
        // Assuming the client sends start of day and end of day, but we ensure it here
        // If the string contains T00:00:00, it works.
        // We will trust the input but ensure comparisons are inclusive.

        const branchFilter: any = {};
        if (branchId && branchId !== 'all') {
            branchFilter.OR = [
                { branchId: String(branchId) },
                { branch: { id: String(branchId) } },
                { patient: { branchId: String(branchId) } } // Fallback to patient branch if needed, but appointment.branchId should be primary
            ];
        }

        const doctorFilter: any = {};
        if (doctorId && doctorId !== 'all') {
            doctorFilter.doctorId = String(doctorId);
        }

        // 1. Fetch appointments in range for Status Distribution
        const appointments = await prisma.appointment.findMany({
            where: {
                date: {
                    gte: start,
                    lte: end
                },
                ...branchFilter,
                ...doctorFilter
            },
            select: {
                id: true,
                status: true,
                patientId: true,
                branchId: true
            }
        });

        // Calculate Status KPIs
        const statusDist = {
            completed: 0,
            cancelled: 0,
            noshow: 0,
            scheduled: 0,
            confirmed: 0,
            billed: 0,
            inprogress: 0
        };

        appointments.forEach(app => {
            const s = app.status;
            if (s === 'COMPLETED') statusDist.completed++;
            else if (s === 'BILLED') statusDist.billed++;
            else if (s === 'CANCELLED') statusDist.cancelled++;
            else if (s === 'NO_SHOW') statusDist.noshow++;
            else if (s === 'SCHEDULED') statusDist.scheduled++;
            else if (s === 'CONFIRMED') statusDist.confirmed++;
            else if (s === 'IN_PROGRESS') statusDist.inprogress++;
        });

        // Aggregate for Dashboard (match frontend expectations)
        // Frontend uses: completed (COMPLETED+BILLED), cancelled (CANCELLED+NO_SHOW)
        const effectiveCompleted = statusDist.completed + statusDist.billed;
        const effectiveCancelled = statusDist.cancelled + statusDist.noshow;

        // 2. Retention Logic
        // Get System Config for Retention Months
        const systemConfig = await prisma.systemSetting.findUnique({
            where: { key: CLINIC_CONFIG_KEY }
        });

        let retentionMonths = 6;
        if (systemConfig && systemConfig.value) {
            const val = systemConfig.value as any;
            if (val.retentionMonths) {
                retentionMonths = parseInt(val.retentionMonths) || 6;
            }
        }

        // Identify unique patients who had a "Visit" (Completed/Billed) in this period
        // Retention implies they came back, so we only count valid visits.
        const visitedPatientIds = new Set<string>();
        appointments.forEach(app => {
            if (app.status === 'COMPLETED' || app.status === 'BILLED') {
                visitedPatientIds.add(app.patientId);
            }
        });

        const patientIds = Array.from(visitedPatientIds);

        // Calculate lookback date
        const lookbackDate = subMonths(start, retentionMonths);

        let recurringCount = 0;
        let newCount = 0;

        if (patientIds.length > 0) {
            // Check history for these patients BEFORE the start date
            // We want the LAST visit before StartDate.

            const lastVisits = await prisma.appointment.groupBy({
                by: ['patientId'],
                where: {
                    patientId: { in: patientIds },
                    date: { lt: start }, // Strictly before period start
                    status: { in: ['COMPLETED', 'BILLED'] } // Only count actual visits
                },
                _max: {
                    date: true
                }
            });

            // Map patientId -> lastVisitDate
            const lastVisitMap = new Map<string, Date>();
            lastVisits.forEach(v => {
                if (v._max.date) {
                    lastVisitMap.set(v.patientId, new Date(v._max.date));
                }
            });

            // Classify
            patientIds.forEach(pid => {
                const lastVisit = lastVisitMap.get(pid);
                if (lastVisit && lastVisit >= lookbackDate) {
                    recurringCount++;
                } else {
                    newCount++;
                }
            });
        }

        res.json({
            retention: {
                recurring: recurringCount,
                new: newCount,
                retentionMonths
            },
            statusDist: {
                completed: effectiveCompleted,
                cancelled: effectiveCancelled,
                breakdown: statusDist
            }
        });

    } catch (error) {
        console.error('Get KPIs Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getNpsStats = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required' });
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));

        if (!isValid(start) || !isValid(end)) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        // 1. Fetch Responses in Range
        const responses = await prisma.npsResponse.findMany({
            where: {
                scoreReceivedAt: {
                    gte: start,
                    lte: end
                },
                score: {
                    not: null
                }
            },
            include: {
                appointment: {
                    include: {
                        patient: true
                    }
                }
            },
            orderBy: {
                scoreReceivedAt: 'desc'
            }
        });

        // 2. Calculate Metrics
        let promoters = 0;
        let passives = 0;
        let detractors = 0;
        const total = responses.length;

        // Feedback buckets
        const feedback = {
            promoters: [] as any[],
            passives: [] as any[],
            detractors: [] as any[]
        };

        responses.forEach(r => {
            const score = r.score || 0;
            const commentData = {
                id: r.id,
                date: r.scoreReceivedAt,
                score: score,
                comment: r.comment,
                patientName: r.appointment.patient.firstName + ' ' + r.appointment.patient.lastName
            };

            if (score >= 9 || score === 5) { // Assuming 5 is Excellent in our 1-3-5 scale or 0-10 scale
                promoters++;
                if (r.comment && feedback.promoters.length < 3) feedback.promoters.push(commentData);
            } else if (score >= 7 || score === 3) { // Assuming 3 is Regular
                passives++;
                if (r.comment && feedback.passives.length < 3) feedback.passives.push(commentData);
            } else { // 1 is Bad
                detractors++;
                if (r.comment && feedback.detractors.length < 3) feedback.detractors.push(commentData);
            }
        });

        // 3. Calculate NPS
        // NPS = % Promoters - % Detractors
        let npsScore = 0;
        if (total > 0) {
            const promoterPct = (promoters / total) * 100;
            const detractorPct = (detractors / total) * 100;
            npsScore = Math.round(promoterPct - detractorPct);
        }

        res.json({
            summary: {
                total,
                npsScore,
                breakdown: {
                    promoters,
                    passives,
                    detractors
                }
            },
            feedback
        });

    } catch (error) {
        console.error('Get NPS Stats Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getReminderStats = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required' });
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));

        if (!isValid(start) || !isValid(end)) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        // 1. Fetch Appointments to define the universe of "Expected" reminders
        const appointments = await prisma.appointment.findMany({
            where: {
                date: {
                    gte: start,
                    lte: end
                },
                type: { not: 'BLOQUEO' as any } // Exclude blocks if necessary
            },
            include: {
                reminders: true
            }
        });

        // 2. Aggregate Stats
        const stats = {
            totalAppointments: appointments.length,
            totalSent: 0,
            confirmed: 0,
            cancelled: 0,
            rescheduled: 0,
            pending: 0,
            noResponse: 0
        };

        appointments.forEach(app => {
            // Find the most relevant reminder (last one sent?)
            // We are interested in the 24h reminder mostly
            const reminder = app.reminders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

            if (reminder && ['sent', 'delivered', 'read', 'confirmed', 'cancelled', 'rescheduled'].includes(reminder.status)) {
                stats.totalSent++;

                if (reminder.status === 'confirmed') stats.confirmed++;
                else if (reminder.status === 'cancelled') stats.cancelled++;
                else if (reminder.status === 'rescheduled') stats.rescheduled++;
                else stats.noResponse++; // sent/delivered/read but no specific action
            } else {
                // If no reminder sent or pending, check Appointment status as fallback?
                // The user specifically asks about the REMINDER performance.
                // So if we rely on reminder.status, we are accurate to the "Change" requested via reminder.
                // However, manual confirmations might update Appointment but not Reminder.
                // Let's check Appointment status if Reminder is just "Sent/Read"

                if (reminder && ['sent', 'delivered', 'read'].includes(reminder.status)) {
                    if (app.status === 'CONFIRMED') stats.confirmed++;
                    else if (app.status === 'CANCELLED') stats.cancelled++;
                    else stats.noResponse++;
                }
            }
        });

        // If we strictly want to count "How many CONFIRMED", we should prioritize the explicit status
        // Current logic above is a bit mixed. Let's simplify:
        // Use Appointment Result as the ultimate truth, but categorize "Reschedule" from Reminder if available?
        // Actually, User wants to know "How many Canceled/Rescheduled" via the system.

        // Re-Do Aggregation specifically on Reminders for clear "Campaign" stats
        // We will query the Reminders directly to get the pure "Bot/Automation" performance.

        const reminders = await prisma.appointmentReminder.findMany({
            where: {
                appointment: {
                    date: {
                        gte: start,
                        lte: end
                    }
                }
            }
        });

        const finalStats = {
            total: 0,
            confirmed: 0,
            cancelled: 0,
            rescheduled: 0,
            no_response: 0
        };

        reminders.forEach(r => {
            if (['sent', 'delivered', 'read', 'confirmed', 'cancelled', 'rescheduled'].includes(r.status)) {
                finalStats.total++;
                if (r.status === 'confirmed') finalStats.confirmed++;
                else if (r.status === 'cancelled') finalStats.cancelled++;
                else if (r.status === 'rescheduled') finalStats.rescheduled++;
                else finalStats.no_response++;
            }
        });

        // Calculate Rates
        const coverageRate = appointments.length > 0 ? Math.round((finalStats.total / appointments.length) * 100) : 0;
        const confirmationRate = finalStats.total > 0 ? Math.round((finalStats.confirmed / finalStats.total) * 100) : 0;
        const cancellationRate = finalStats.total > 0 ? Math.round((finalStats.cancelled / finalStats.total) * 100) : 0;

        res.json({
            totalAppointments: appointments.length,
            totalSent: finalStats.total,
            distribution: {
                confirmed: finalStats.confirmed,
                cancelled: finalStats.cancelled, // Include rescheduled here? Or ignore? UI only has 3 buckets. Let's keep strict cancelled.
                pending: finalStats.no_response + finalStats.rescheduled // Treat rescheduled as pending/other or cancelled? Usually pending resolution.
            },
            rates: {
                confirmationRate,
                cancellationRate,
                coverageRate
            }
        });

    } catch (error) {
        console.error('Get Reminder Stats Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getReminderDetails = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required' });
        }

        const start = new Date(String(startDate));
        const end = new Date(String(endDate));

        if (!isValid(start) || !isValid(end)) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        const reminders = await prisma.appointmentReminder.findMany({
            where: {
                appointment: {
                    date: {
                        gte: start,
                        lte: end
                    }
                }
            },
            include: {
                appointment: {
                    include: {
                        patient: true,
                        doctor: true
                    }
                }
            },
            orderBy: {
                sentAt: 'desc'
            }
        });

        const details = reminders.map(r => ({
            id: r.id,
            patientName: `${r.appointment.patient.firstName} ${r.appointment.patient.lastName}`,
            patientPhone: r.appointment.patient.phone,
            appointmentDate: r.appointment.date,
            sentAt: r.sentAt,
            status: r.status, // confirmed, cancelled, rescheduled, sent, read
            response: r.patientResponse, // Actual text if available
            appointmentStatus: r.appointment.status // Current real status
        }));

        res.json(details);

    } catch (error) {
        console.error('Get Reminder Details Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
