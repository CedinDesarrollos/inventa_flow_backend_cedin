import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const availabilityQuerySchema = z.object({
    date: z.string().datetime(),
    duration: z.string().transform(Number) // Duration in minutes
});

const slotsQuerySchema = z.object({
    date: z.string().datetime(),
    professionalId: z.string(),
    duration: z.string().transform(Number),
    branchId: z.string().optional()
});

export const getAvailableProfessionals = async (req: Request, res: Response) => {
    try {
        const { date, duration } = availabilityQuerySchema.parse(req.query);
        const start = new Date(date);
        const end = new Date(start.getTime() + duration * 60000);

        // 1. Get all professionals
        // En un futuro, filtraremos por "Working Hours" aquí también
        const allProfessionals = await prisma.professional.findMany({
            include: { user: true }
        });

        // 2. Find professionals with overlapping appointments
        const busyProfessionals = await prisma.appointment.findMany({
            where: {
                status: { not: 'CANCELLED' },
                OR: [
                    {
                        date: { lt: end },
                        endDate: { gt: start }
                    }
                ]
            },
            select: {
                doctorId: true
            }
        });

        const busyDoctorIds = new Set(busyProfessionals.map(a => a.doctorId).filter(Boolean));

        // 3. Filter available professionals
        // Note: appointment.doctorId refers to User.id
        const availableProfessionals = allProfessionals.filter(prof => {
            return !busyDoctorIds.has(prof.userId);
        });

        res.json(availableProfessionals);
    } catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Invalid parameters' });
    }
};

export const getAvailableSlots = async (req: Request, res: Response) => {
    try {
        const { date, professionalId, duration, branchId } = slotsQuerySchema.parse(req.query);

        // ID Resolution: Ensure we have the USER ID (which is what Appointment.doctorId uses)
        // The frontend might be sending the Professional ID (UUID) instead of the User ID.
        let userId = professionalId;
        const potentialProf = await prisma.professional.findUnique({
            where: { id: professionalId },
            select: { userId: true }
        });
        if (potentialProf) {
            userId = potentialProf.userId;
        }

        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        // 1. Get Professional Schedule for this day of week (0=Sunday)
        const dayOfWeek = dayStart.getDay();

        // Default: 08:00 - 18:00 (User Requested 8am start)
        let workStartHour = 8;
        let workEndHour = 18;

        // Try to find specific configuration using the resolved User ID
        const professional = await prisma.professional.findFirst({
            where: { userId: userId }
        });

        if (professional && professional.workingHours) {
            const wh = professional.workingHours as any;
            let scheduleConfig = null;

            if (Array.isArray(wh)) {
                // If branchId is provided, look for that specific branch config
                if (branchId) {
                    scheduleConfig = wh.find((cfg: any) => cfg.branchId === branchId);
                }
                // If no branchId or config not found, maybe fallback to first active or 'main'?
                // For now, if no branchId, we stick to default or aggregate? 
                // Let's assume strict branch scheduling if provided.
            } else {
                // Legacy object format
                scheduleConfig = wh;
            }

            if (scheduleConfig) {
                // Check if working this day
                if (scheduleConfig.days && scheduleConfig.days.includes(dayOfWeek)) {
                    // Use custom hours if available
                    if (scheduleConfig.start) {
                        const [h, m] = scheduleConfig.start.split(':').map(Number);
                        workStartHour = h; // Ignore minutes for slots start anchor for now, or improve later
                    }
                    if (scheduleConfig.end) {
                        const [h, m] = scheduleConfig.end.split(':').map(Number);
                        workEndHour = h;
                    }
                }
            }
        }

        // Timezone Fix: The migration stored legacy appointments as "Face Value UTC" (e.g. 09:00 stored as 09:00Z).
        // If we apply a shift (e.g. +3), we look at 12:00Z which is wrong relative to the data.
        // We align logic to use the Face Value UTC hours directly.
        const TZ_OFFSET = 0;

        const scheduleStart = new Date(dayStart);
        scheduleStart.setHours(workStartHour + TZ_OFFSET, 0, 0, 0);

        const scheduleEnd = new Date(dayStart);
        scheduleEnd.setHours(workEndHour + TZ_OFFSET, 0, 0, 0);

        // 2. Get existing appointments for this professional on this day
        const appointments = await prisma.appointment.findMany({
            where: {
                doctorId: userId, // Use resolved User ID
                status: { not: 'CANCELLED' },
                date: {
                    gte: dayStart,
                    lte: dayEnd
                }
            },
            orderBy: {
                date: 'asc'
            }
        });

        // 3. Calculate Slots (Grid Search Strategy)
        // User needs flexible start times (e.g. 9:30) even if grid isn't perfectly packed.
        // We iterate by a small step (e.g. 10 mins) to find all valid start times.
        const SLOT_STEP = 10; // Minutes
        const slots: string[] = [];
        let cursor = new Date(scheduleStart);

        while (cursor.getTime() + duration * 60000 <= scheduleEnd.getTime()) {
            const slotEnd = new Date(cursor.getTime() + duration * 60000);

            // Check collision with ANY appointment
            const collision = appointments.find(appt => {
                const apptStart = new Date(appt.date);
                const apptEnd = appt.endDate ? new Date(appt.endDate) : new Date(apptStart.getTime() + appt.duration * 60000);

                // Collision if: (Cursor < ApptEnd) AND (SlotEnd > ApptStart)
                return cursor < apptEnd && slotEnd > apptStart;
            });

            if (!collision) {
                // Valid slot found
                // OUTPUT SHIFT: Add 3 hours so frontend (-3h) displays correct face value
                // Example: DB 09:00 -> Output 12:00 -> Frontend sees 09:00
                const outputTime = new Date(cursor.getTime() + 3 * 3600000);
                slots.push(outputTime.toISOString());
            }

            // Always increment by fixed step to allow flexible scheduling
            // (e.g. can start at 9:00, 9:10, 9:20, 9:30...)
            cursor = new Date(cursor.getTime() + SLOT_STEP * 60000);
        }

        res.json(slots);
    } catch (error) {
        console.error('Error calculating slots:', error);
        res.status(400).json({ error: 'Invalid parameters or calculation error' });
    }
};
