import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { userProfileSelect } from '../lib/user-profile';
import { z } from 'zod';
import { appointmentEnd } from '../services/appointments/AppointmentService';
import { dayKey, toMinutes, windowsForDay } from '../services/schedule/workingWindows';

const availabilityQuerySchema = z.object({
    date: z.string().datetime(),
    duration: z.string().transform(Number).pipe(z.number().int().min(5)) // Duration in minutes
});

const slotsQuerySchema = z.object({
    date: z.string().datetime(),
    professionalId: z.string(),
    duration: z.string().transform(Number).pipe(z.number().int().min(5)),
    branchId: z.string().optional(),
    preferredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()
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
        const { date, professionalId, duration, branchId, preferredTime } = slotsQuerySchema.parse(req.query);

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

        const professional = await prisma.professional.findFirst({ where: { userId } });
        const exceptions = professional
            ? await prisma.scheduleException.findMany({
                where: { professionalId: professional.id, status: 'APPROVED', dateFrom: { lte: dayStart }, dateTo: { gte: dayStart } }
            })
            : [];
        // Sin horario ese día (o ausente) => sin turnos; ya no se cae en 08:00-18:00.
        const windows = windowsForDay(professional?.workingHours, exceptions, dayStart, branchId).map(w => {
            const from = new Date(dayStart), to = new Date(dayStart);
            from.setUTCMinutes(toMinutes(w.start));
            to.setUTCMinutes(toMinutes(w.end));
            return { from, to };
        });
        if (!windows.length) return res.json([]);
        const scheduleStart = windows[0].from;
        const scheduleEnd = new Date(Math.max(...windows.map(w => w.to.getTime())));

        // 2. Get existing appointments for this professional on this day
        const appointments = await prisma.$queryRaw<{ date: Date; duration: number }[]>`
            SELECT date, duration FROM inventa_clinical_app.appointments
            WHERE doctor_id = ${userId} AND status <> 'CANCELLED'
              AND date < ${scheduleEnd}
              AND date + duration * interval '1 minute' > ${scheduleStart}
            ORDER BY date ASC
        `;

        // 3. Calculate Slots (Grid Search Strategy) inside each window
        const SLOT_STEP = 10; // Minutes
        const slots: string[] = [];
        const isFree = (start: Date, end: Date) => !appointments.some(appt =>
            start < appointmentEnd(new Date(appt.date), appt.duration) && end > new Date(appt.date));

        for (const w of windows) {
            for (let cursor = w.from; cursor.getTime() + duration * 60000 <= w.to.getTime(); cursor = new Date(cursor.getTime() + SLOT_STEP * 60000)) {
                if (isFree(cursor, new Date(cursor.getTime() + duration * 60000))) slots.push(cursor.toISOString());
            }
        }

        // Calendar selections need not coincide with the ten-minute grid.
        if (preferredTime) {
            const preferred = new Date(dayStart);
            const [hour, minute] = preferredTime.split(':').map(Number);
            preferred.setUTCHours(hour, minute, 0, 0);
            const end = appointmentEnd(preferred, duration);
            if (windows.some(w => preferred >= w.from && end <= w.to) && isFree(preferred, end)) {
                if (!slots.includes(preferred.toISOString())) slots.push(preferred.toISOString());
            }
        }
        res.json([...new Set(slots)].sort());
    } catch (error) {
        console.error('Error calculating slots:', error);
        res.status(400).json({ error: 'Invalid parameters or calculation error' });
    }
};

const windowsQuerySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    branchId: z.string().optional()
});

/** Franjas efectivas de cada profesional para un día (base + particulares - ausencias). */
export const getDayWindows = async (req: Request, res: Response) => {
    try {
        const { date, branchId } = windowsQuerySchema.parse(req.query);
        const day = new Date(`${date}T00:00:00.000Z`);
        const [professionals, exceptions] = await Promise.all([
            prisma.professional.findMany({ select: { id: true, userId: true, workingHours: true } }),
            prisma.scheduleException.findMany({ where: { status: 'APPROVED', dateFrom: { lte: day }, dateTo: { gte: day } } })
        ]);
        res.json(professionals.map(p => ({
            professionalId: p.id,
            userId: p.userId,
            date: dayKey(day),
            windows: windowsForDay(p.workingHours, exceptions.filter(e => e.professionalId === p.id), day, branchId)
        })));
    } catch (error) {
        console.error('Error calculating windows:', error);
        res.status(400).json({ error: 'Invalid parameters' });
    }
};
