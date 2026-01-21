import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

// Validation schemas
const tariffSchema = z.object({
    insuranceId: z.string().uuid(),
    serviceId: z.string().uuid(),
    coverageType: z.enum(['fixed', 'percentage']),
    value: z.number().positive()
});

export const getTariffs = async (req: Request, res: Response) => {
    try {
        const { insuranceId, serviceId } = req.query;

        const where: any = {};
        if (insuranceId) where.insuranceId = String(insuranceId);
        if (serviceId) where.serviceId = String(serviceId);

        const tariffs = await prisma.tariff.findMany({
            where,
            include: {
                insurance: true,
                service: true
            }
        });

        res.json(tariffs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener tarifas' });
    }
};

export const getTariff = async (req: Request, res: Response) => {
    try {
        const { insuranceId, serviceId } = req.params as { insuranceId: string; serviceId: string };

        const tariff = await prisma.tariff.findUnique({
            where: {
                insuranceId_serviceId: {
                    insuranceId,
                    serviceId
                }
            },
            include: {
                insurance: true,
                service: true
            }
        });

        if (!tariff) {
            return res.status(404).json({ error: 'Tarifa no encontrada' });
        }

        res.json(tariff);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener tarifa' });
    }
};

export const createTariff = async (req: Request, res: Response) => {
    try {
        const data = tariffSchema.parse(req.body);

        const tariff = await prisma.tariff.create({
            data: {
                insuranceId: data.insuranceId,
                serviceId: data.serviceId,
                coverageType: data.coverageType,
                value: data.value
            },
            include: {
                insurance: true,
                service: true
            }
        });

        res.status(201).json(tariff);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.issues });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al crear tarifa' });
    }
};

export const updateTariff = async (req: Request, res: Response) => {
    try {
        const { insuranceId, serviceId } = req.params as { insuranceId: string; serviceId: string };
        const data = tariffSchema.partial().parse(req.body);

        const tariff = await prisma.tariff.update({
            where: {
                insuranceId_serviceId: {
                    insuranceId,
                    serviceId
                }
            },
            data: {
                coverageType: data.coverageType,
                value: data.value
            },
            include: {
                insurance: true,
                service: true
            }
        });

        res.json(tariff);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar tarifa' });
    }
};

export const deleteTariff = async (req: Request, res: Response) => {
    try {
        const { insuranceId, serviceId } = req.params as { insuranceId: string; serviceId: string };

        await prisma.tariff.delete({
            where: {
                insuranceId_serviceId: {
                    insuranceId,
                    serviceId
                }
            }
        });

        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar tarifa' });
    }
};
