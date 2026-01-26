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
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        // 1. Get Professional Schedule for this day of week (0=Sunday)
        const dayOfWeek = dayStart.getDay();

        // Default: 08:00 - 18:00 (User Requested 8am start)
        let workStartHour = 8;
        let workEndHour = 18;

        // Try to find specific configuration
        const professional = await prisma.professional.findFirst({
            where: { userId: professionalId }
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

        // Timezone Fix: The server is in UTC, but the client assumes the hours are Local (-3)
        // If config says 08:00 (Local), this means 11:00 UTC.
        // So we need to add 3 hours to the target UTC hour.
        const TZ_OFFSET = 3;

        const scheduleStart = new Date(dayStart);
        scheduleStart.setHours(workStartHour + TZ_OFFSET, 0, 0, 0);

        const scheduleEnd = new Date(dayStart);
        scheduleEnd.setHours(workEndHour + TZ_OFFSET, 0, 0, 0);

        // 2. Get existing appointments for this professional on this day
        const appointments = await prisma.appointment.findMany({
            where: {
                doctorId: professionalId,
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

        // 3. Calculate Slots (Dynamic Anchoring)
        // Strategy: Iterate from scheduleStart. 
        // If current time overlaps with an appointment, jump to appointment end.
        // Else, checking if slot fits. If fits, add to list and jump by duration (or custom step).
        // For Dynamic Anchoring (Option B), we specifically want to anchor to:
        // - Start of day
        // - End of previous appointment

        const slots: string[] = [];
        let cursor = new Date(scheduleStart);

        while (cursor.getTime() + duration * 60000 <= scheduleEnd.getTime()) {
            const slotEnd = new Date(cursor.getTime() + duration * 60000);

            // Check collision with ANY appointment
            const collision = appointments.find(appt => {
                const apptStart = new Date(appt.date);
                const apptEnd = appt.endDate ? new Date(appt.endDate) : new Date(apptStart.getTime() + appt.duration * 60000);

                // Allow touching edges? Usually start == apptEnd is fine.
                // Collision if: (Cursor < ApptEnd) AND (SlotEnd > ApptStart)
                return cursor < apptEnd && slotEnd > apptStart;
            });

            if (collision) {
                // Determine jump
                const apptStart = new Date(collision.date);
                const apptEnd = collision.endDate ? new Date(collision.endDate) : new Date(apptStart.getTime() + collision.duration * 60000);

                // If cursor is before appointment start, we have a gap SMALLER than duration.
                // Move cursor to appointment END to try finding next valid slot.
                // This effectively "anchors" the next check to the end of the existing busy block.
                cursor = apptEnd;
            } else {
                // Valid slot found
                slots.push(cursor.toISOString());

                // Advance cursor. 
                // For "Fixed Grid", we would do: cursor = new Date(cursor.getTime() + STEP);
                // For "Dynamic Anchoring" (to pack appointments), we CAN simply offer this slot and advance by STEP or Duration.
                // To minimize gaps, we suggest slots starting immediately after.
                // However, user might want to see options every 15 mins?
                // Option B strict: Only show start times that align with "Just Now" or "After Appointment".
                // Let's implement a hybrid: Move by duration to show consecutive slots.
                cursor = new Date(cursor.getTime() + duration * 60000);
            }
        }

        res.json(slots);
    } catch (error) {
        console.error('Error calculating slots:', error);
        res.status(400).json({ error: 'Invalid parameters or calculation error' });
    }
};
