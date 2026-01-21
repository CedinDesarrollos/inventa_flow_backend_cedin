import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const createVisitSchema = z.object({
    visitorName: z.string().min(1, 'Nombre del visitador es requerido'),
    laboratory: z.string().min(1, 'Laboratorio es requerido'),
    branchId: z.string().uuid('ID de sede inválido'),
    professionalId: z.string().uuid('ID de profesional inválido'),
    notes: z.string().optional()
});

export const createVisit = async (req: Request, res: Response) => {
    try {
        const data = createVisitSchema.parse(req.body);

        const visit = await prisma.medicalVisit.create({
            data: {
                visitorName: data.visitorName,
                laboratory: data.laboratory,
                branchId: data.branchId,
                professionalId: data.professionalId,
                notes: data.notes,
                status: 'WAITING'
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                professional: {
                    select: {
                        id: true,
                        fullName: true
                    }
                }
            }
        });

        res.status(201).json(visit);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos inválidos', details: error.issues });
        }
        console.error('Error creating visit:', error);
        res.status(500).json({ error: 'Error al crear visita' });
    }
};

export const getVisits = async (req: Request, res: Response) => {
    try {
        const { branchId, professionalId, status, date } = req.query;

        console.log('getVisits called with params:', { branchId, professionalId, status, date });

        const where: any = {};

        if (branchId && typeof branchId === 'string') where.branchId = branchId;
        if (professionalId && typeof professionalId === 'string') where.professionalId = professionalId;
        if (status && typeof status === 'string') {
            // Handle multiple statuses separated by comma
            const statuses = status.split(',');
            where.status = { in: statuses };
        }

        if (date && typeof date === 'string') {
            const startOfDay = new Date(date);
            startOfDay.setUTCHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setUTCHours(23, 59, 59, 999);

            where.createdAt = {
                gte: startOfDay,
                lte: endOfDay
            };

            console.log('Date filter applied:', { startOfDay, endOfDay });
        }

        console.log('Querying medical visits with where:', JSON.stringify(where, null, 2));

        const visits = await prisma.medicalVisit.findMany({
            where,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                professional: {
                    select: {
                        id: true,
                        fullName: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        console.log(`Found ${visits.length} medical visits`);

        res.json(visits);
    } catch (error) {
        console.error('Error fetching visits:', error);
        res.status(500).json({ error: 'Error al obtener visitas' });
    }
};

export const updateVisitStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'ID inválido' });
        }

        if (!['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        const visit = await prisma.medicalVisit.update({
            where: { id },
            data: { status },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                professional: {
                    select: {
                        id: true,
                        fullName: true
                    }
                }
            }
        });

        res.json(visit);
    } catch (error) {
        console.error('Error updating visit status:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
};

export const getVisitById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const visit = await prisma.medicalVisit.findUnique({
            where: { id },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                professional: {
                    select: {
                        id: true,
                        fullName: true
                    }
                }
            }
        });

        if (!visit) {
            return res.status(404).json({ error: 'Visita no encontrada' });
        }

        res.json(visit);
    } catch (error) {
        console.error('Error fetching visit:', error);
        res.status(500).json({ error: 'Error al obtener visita' });
    }
};
