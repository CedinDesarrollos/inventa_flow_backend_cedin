import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { userProfileSelect } from '../lib/user-profile';
import { z } from 'zod';
import { appointmentEnd } from '../services/appointments/AppointmentService';

const availabilityQuerySchema = z.object({
    date: z.string().datetime(),
    duration: z.string().transform(Number).pipe(z.number().int().min(5)) // Duration in minutes
});

const slotsQuerySchema = z.object({
    date: z.string().datetime(),
    professionalId: z.string(),
    duration: z.string().transform(Number).pipe(z.number().int().min(5)),
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
            include: { user: { select: userProfileSelect } }
        });

        // 2. Find professionals with overlapping appointments
        const busyProfessionals = await prisma.$queryRaw<{ doctorId: string | null }[]>`
            SELECT DISTINCT doctor_id AS "doctorId" FROM inventa_clinical_app.appointments
            WHERE status <> 'CANCELLED' AND date < ${end}
              AND date + duration * interval '1 minute' > ${start}
        `;

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

        let userId = professionalId;
        const potentialProf = await prisma.professional.findUnique({
            where: { id: professionalId },
            select: { userId: true }
        });
        if (potentialProf) {
            userId = potentialProf.userId;
        }

        // Face Value UTC: Treat the requested input date as UTC
        const dayStart = new Date(date);
        dayStart.setUTCHours(0, 0, 0, 0);

        // 1. Get Professional Schedule for this day of week (0=Sunday)
        const dayOfWeek = dayStart.getUTCDay();

        // Default: 08:00 - 18:00
        let workStartHour = 8;
        let workEndHour = 18;

        const professional = await prisma.professional.findFirst({
            where: { userId: userId }
        });

        if (professional && professional.workingHours) {
            const wh = professional.workingHours as any;
            let scheduleConfig = null;

            if (Array.isArray(wh)) {
                if (branchId) {
                    scheduleConfig = wh.find((cfg: any) => cfg.branchId === branchId);
                }
            } else {
                scheduleConfig = wh;
            }

            if (scheduleConfig) {
                if (scheduleConfig.days && scheduleConfig.days.includes(dayOfWeek)) {
                    if (scheduleConfig.start) {
                        const [h, m] = scheduleConfig.start.split(':').map(Number);
                        workStartHour = h;
                    }
                    if (scheduleConfig.end) {
                        const [h, m] = scheduleConfig.end.split(':').map(Number);
                        workEndHour = h;
                    }
                }
            }
        }

        const scheduleStart = new Date(dayStart);
        scheduleStart.setUTCHours(workStartHour, 0, 0, 0);

        const scheduleEnd = new Date(dayStart);
        scheduleEnd.setUTCHours(workEndHour, 0, 0, 0);

        // 2. Get existing appointments for this professional on this day
        const appointments = await prisma.$queryRaw<{ date: Date; duration: number }[]>`
            SELECT date, duration FROM inventa_clinical_app.appointments
            WHERE doctor_id = ${userId} AND status <> 'CANCELLED'
              AND date < ${scheduleEnd}
              AND date + duration * interval '1 minute' > ${scheduleStart}
            ORDER BY date ASC
        `;

        // 3. Calculate Slots (Grid Search Strategy)
        const SLOT_STEP = 10; // Minutes
        const slots: string[] = [];
        let cursor = new Date(scheduleStart);

        while (cursor.getTime() + duration * 60000 <= scheduleEnd.getTime()) {
            const slotEnd = new Date(cursor.getTime() + duration * 60000);

            const collision = appointments.find(appt => {
                const apptStart = new Date(appt.date);
                const apptEnd = appointmentEnd(apptStart, appt.duration);

                return cursor < apptEnd && slotEnd > apptStart;
            });

            if (!collision) {
                // Return pure UTC string
                slots.push(cursor.toISOString());
            }

            cursor = new Date(cursor.getTime() + SLOT_STEP * 60000);
        }

        res.json(slots);
    } catch (error) {
        console.error('Error calculating slots:', error);
        res.status(400).json({ error: 'Invalid parameters or calculation error' });
    }
};
