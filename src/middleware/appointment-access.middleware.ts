import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from './auth.middleware';

// Match the professional's own-agenda restriction already used by the UI.
export const restrictAppointmentAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'PROFESSIONAL') return next();

    const userId = req.user.userId;
    const requestedDoctorId = req.method === 'GET' ? req.query.doctorId : req.body?.doctorId;
    if (requestedDoctorId !== undefined && requestedDoctorId !== userId) {
        return res.status(403).json({ message: 'Solo puede gestionar su propia agenda' });
    }

    try {
        if (req.params.id) {
            const appointment = await prisma.appointment.findUnique({
                where: { id: String(req.params.id) },
                select: { doctorId: true }
            });
            if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
            if (appointment.doctorId !== userId) {
                return res.status(403).json({ message: 'Solo puede gestionar su propia agenda' });
            }
        }

        // POST / and /close-agenda must never default to an unassigned or global agenda.
        if (req.method === 'POST') {
            req.body = { ...req.body, doctorId: userId };
        }
        return next();
    } catch (error) {
        console.error('Appointment access check failed:', error);
        return res.status(500).json({ error: 'Error al verificar acceso a la cita' });
    }
};
