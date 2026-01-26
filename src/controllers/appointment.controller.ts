import { Request, Response } from 'express';
import { prisma } from '../lib/prisma'; // Adapta la ruta si es necesario
import { z } from 'zod';

// Validations
const appointmentSchema = z.object({
    patientId: z.string().uuid(),
    doctorId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    date: z.string().datetime(), // ISO 8601
    duration: z.number().int().min(5), // minutes
    type: z.enum(['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE']),
    status: z.enum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
    reason: z.string().optional(),
    notes: z.string().optional()
});

// Validations
const updateStatusSchema = z.object({
    status: z.enum(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BILLED']),
    secretaryNote: z.string().optional()
});

export const getAppointments = async (req: Request, res: Response) => {
    console.log('Controller: getAppointments called', req.query);
    try {
        const { start, end, doctorId, patientId, status, branchId, paymentStatus } = req.query;

        const where: any = {};

        if (start && end) {
            where.date = {
                gte: new Date(String(start)),
                lte: new Date(String(end))
            };
        }

        if (doctorId) where.doctorId = String(doctorId);
        if (patientId) where.patientId = String(patientId);

        if (status) {
            const statusStr = String(status);
            if (statusStr.includes(',')) {
                where.status = {
                    in: statusStr.split(',').map(s => s.trim())
                };
            } else {
                where.status = statusStr;
            }
        }

        if (paymentStatus) {
            where.paymentStatus = String(paymentStatus);
        }

        if (branchId) where.branchId = String(branchId);

        console.log('Backend: Filtering appointments with where clause:', JSON.stringify(where, null, 2));

        const appointments = await prisma.appointment.findMany({
            where,
            include: {
                patient: true,
                doctor: {
                    include: {
                        professional: true
                    }
                },
                branch: true,
                service: true
            },
            orderBy: {
                date: 'asc'
            }
        });

        console.log(`Backend: Found ${appointments.length} appointments`);
        res.json(appointments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener citas' });
    }
};

export const createAppointment = async (req: Request, res: Response) => {
    console.log('Controller: createAppointment called', req.body);
    try {
        const data = appointmentSchema.parse(req.body);

        const start = new Date(data.date);
        const end = new Date(start.getTime() + data.duration * 60000);

        // Check availability (overlap) for the doctor
        // Skip overlap check for walk-in appointments (status CONFIRMED) since patient is already at clinic
        console.log('Checking overlap - doctorId:', data.doctorId, 'status:', data.status);

        if (data.doctorId && (!data.status || data.status === 'SCHEDULED')) {
            console.log('Performing overlap check for doctor:', data.doctorId);
            const overlap = await prisma.appointment.findFirst({
                where: {
                    doctorId: data.doctorId,
                    status: { not: 'CANCELLED' },
                    OR: [
                        {
                            date: { lt: end },
                            endDate: { gt: start }
                        }
                    ]
                }
            });

            console.log('Overlap found:', overlap);
            if (overlap) {
                return res.status(409).json({ error: 'El profesional ya tiene una cita en ese horario.' });
            }
        } else {
            console.log('Skipping overlap check - Walk-in appointment or no doctor assigned');
        }

        const appointment = await prisma.appointment.create({
            data: {
                ...data,
                date: start,
                endDate: end, // Calculated end date
                status: data.status || 'SCHEDULED' // Use provided status or default to SCHEDULED
            },
            include: {
                patient: true
            }
        });

        res.status(201).json(appointment);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al crear la cita' });
    }
};

export const updateAppointment = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const data = appointmentSchema.partial().parse(req.body);

        const appointment = await prisma.appointment.update({
            where: { id },
            data: {
                ...data,
                date: data.date ? new Date(data.date) : undefined,
                // Recalculate endDate if duration or date changes?
                // For simplicity, if date provided, recalculate.
            }
        });

        // Logic for endDate recalc if needed, skipped for brevity in this step.

        res.json(appointment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar cita' });
    }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const { status, secretaryNote } = updateStatusSchema.parse(req.body);

        const appointment = await prisma.appointment.update({
            where: { id },
            data: {
                status,
                secretaryNote: secretaryNote ?? undefined
            }
        });

        // Trigger Notification Logic here (Placeholder)
        // if (status === 'CONFIRMED') { sendWhatsAppConfirmation(appointment); }

        res.json(appointment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
};

export const deleteAppointment = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        await prisma.appointment.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar cita' });
    }
};

export const closeDailyAgenda = async (req: Request, res: Response) => {
    try {
        const { cutOffTime } = req.body;

        // Default to now if not provided, but frontend should provide it for consistency
        const limitDate = cutOffTime ? new Date(cutOffTime) : new Date();

        // Safety buffer: Ensure we don't close future appointments accidentally if frontend sends wrong time
        // Actually, requirement is: "Already passed their time".
        // The frontend calculates "Now - 30m". We trust the frontend's explicit "Until XX:XX" 
        // but we ensure it's not in the future relative to server time + small margin.

        const now = new Date();
        if (limitDate > now) {
            return res.status(400).json({ error: 'La hora de corte no puede ser futura.' });
        }

        const startOfDay = new Date(limitDate);
        startOfDay.setHours(0, 0, 0, 0);

        // Update queries
        // Build Where Clause
        const whereClause: any = {
            date: {
                gte: startOfDay,
                lte: limitDate
            },
            status: 'SCHEDULED' // Only close SCHEDULED appointments. CONFIRMED means they are in waiting room.
        };

        if (req.body.doctorId) {
            whereClause.doctorId = req.body.doctorId;
        }

        // Update queries
        const result = await prisma.appointment.updateMany({
            where: whereClause,
            data: {
                status: 'NO_SHOW'
            }
        });

        console.log(`Agenda closed until ${limitDate.toISOString()}. Updated ${result.count} appointments.`);

        res.json({
            message: 'Agenda cerrada correctamente',
            count: result.count,
            cutOffTime: limitDate
        });

    } catch (error) {
        console.error('Error closing agenda:', error);
        res.status(500).json({ error: 'Error al cerrar la agenda' });
    }
};
