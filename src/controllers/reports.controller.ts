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

        // 1. Fetch Appointments (Agenda Universe)
        const appointments = await prisma.appointment.findMany({
            where: {
                date: {
                    gte: start,
                    lte: end
                }
            },
            select: {
                id: true,
                status: true
            }
        });

        // 2. Fetch Actual Sent Reminders (Action Universe)
        // We look for reminders linked to the appointments in the range. 
        // This is more accurate than just date range on reminders because it links effort to the specific appointment slot.
        const appointmentIds = appointments.map(a => a.id);

        let sentRemindersCount = 0;
        if (appointmentIds.length > 0) {
            sentRemindersCount = await prisma.appointmentReminder.count({
                where: {
                    appointmentId: { in: appointmentIds },
                    status: {
                        in: ['sent', 'delivered', 'read', 'confirmed', 'cancelled', 'rescheduled'] // successfully sent statuses
                    }
                }
            });
        }

        // 3. Calculate Outcomes based on Appointment Status
        const stats = {
            totalAppointments: appointments.length,
            totalSent: sentRemindersCount,
            confirmed: 0,
            cancelled: 0,
            rescheduled: 0,
            pending: 0,
            attended: 0
        };

        appointments.forEach(app => {
            const s = app.status;
            if (s === 'CONFIRMED') stats.confirmed++;
            else if (s === 'CANCELLED' || s === 'NO_SHOW') stats.cancelled++;
            else if (s === 'SCHEDULED') stats.pending++;
            else if (s === 'COMPLETED' || s === 'BILLED' || s === 'IN_PROGRESS') stats.attended++;
        });

        const effectiveConfirmed = stats.confirmed + stats.attended;

        res.json({
            totalAppointments: stats.totalAppointments,
            totalSent: stats.totalSent,
            distribution: {
                confirmed: effectiveConfirmed,
                cancelled: stats.cancelled,
                pending: stats.pending
            },
            rates: {
                // Rate over Total Appointments (General Efficiency)
                confirmationRate: stats.totalAppointments > 0 ? Math.round((effectiveConfirmed / stats.totalAppointments) * 100) : 0,
                cancellationRate: stats.totalAppointments > 0 ? Math.round((stats.cancelled / stats.totalAppointments) * 100) : 0,
                // Coverage (Sent / Total)
                coverageRate: stats.totalAppointments > 0 ? Math.round((stats.totalSent / stats.totalAppointments) * 100) : 0
            }
        });

    } catch (error) {
        console.error('Get Reminder Stats Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
