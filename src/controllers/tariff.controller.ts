import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

// Validation schemas
const tariffSchema = z.object({
    insuranceId: z.string().uuid(),
    serviceId: z.string().uuid(),
    professionalId: z.string().uuid().optional().nullable(),
    coverageType: z.enum(['fixed', 'percentage']),
    value: z.number().positive()
});

export const getTariffs = async (req: Request, res: Response) => {
    try {
        const { insuranceId, serviceId } = req.query;

        const where: any = {};
        if (insuranceId) where.insuranceId = String(insuranceId);
        if (serviceId) where.serviceId = String(serviceId);

        // Handle professional filtering
        const { professionalId } = req.query;
        if (professionalId === 'null') {
            where.professionalId = null;
        } else if (professionalId) {
            where.professionalId = String(professionalId);
        }

        const tariffs = await prisma.tariff.findMany({
            where,
            include: {
                insurance: true,
                service: true,
                professional: true
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
        const professionalId = req.params.professionalId && req.params.professionalId !== 'global'
            ? req.params.professionalId
            : null;

        const tariff = await prisma.tariff.findUnique({
            where: {
                insuranceId_serviceId_professionalId: {
                    insuranceId,
                    serviceId,
                    professionalId: professionalId as string | null // Prisma expects string | null, but let's be safe
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
                professionalId: data.professionalId,
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
        const professionalId = req.params.professionalId && req.params.professionalId !== 'global'
            ? req.params.professionalId
            : null;

        const data = tariffSchema.partial().parse(req.body);

        const tariff = await prisma.tariff.update({
            where: {
                insuranceId_serviceId_professionalId: {
                    insuranceId,
                    serviceId,
                    professionalId: professionalId as string | null
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
        const professionalId = req.params.professionalId && req.params.professionalId !== 'global'
            ? req.params.professionalId
            : null;

        await prisma.tariff.delete({
            where: {
                insuranceId_serviceId_professionalId: {
                    insuranceId,
                    serviceId,
                    professionalId: professionalId as string | null
                }
            }
        });

        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar tarifa' });
    }
};

export const resolvePrice = async (req: Request, res: Response) => {
    try {
        const { insuranceId, serviceId, professionalId } = req.query;

        if (!serviceId) return res.status(400).json({ error: 'Service ID required' });

        // 1. Get Base Service Price
        const service = await prisma.service.findUnique({ where: { id: String(serviceId) } });
        if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

        // If no insurance, return private price
        if (!insuranceId || insuranceId === 'private') {
            return res.json({ price: service.price, source: 'private', coverage: 0 });
        }

        // 2. If Professional is specified, verify acceptance and look for specific tariff
        if (professionalId && professionalId !== 'null' && professionalId !== 'undefined') {
            const professional = await prisma.professional.findUnique({
                where: { id: String(professionalId) },
                include: { acceptedInsurances: true }
            });

            if (professional) {
                const acceptsInsurance = professional.acceptedInsurances.some(i => i.id === insuranceId);
                if (!acceptsInsurance) {
                    return res.json({
                        price: service.price,
                        source: 'private_not_accepted',
                        message: `El profesional no atiende con este seguro`,
                        coverage: 0
                    });
                }

                // Look for Specific Tariff
                const specificTariff = await prisma.tariff.findUnique({
                    where: {
                        insuranceId_serviceId_professionalId: {
                            insuranceId: String(insuranceId),
                            serviceId: String(serviceId),
                            professionalId: String(professionalId)
                        }
                    }
                });

                if (specificTariff) {
                    return res.json({
                        tariff: specificTariff,
                        source: 'specific',
                        basePrice: service.price
                    });
                }
            }
        }

        // 4. Look for Global Tariff (if no specific founded OR no professional specified)
        // Needs findFirst because we search for professionalId = null
        // Using findFirst with where clause
        const globalTariff = await prisma.tariff.findFirst({
            where: {
                insuranceId: String(insuranceId),
                serviceId: String(serviceId),
                professionalId: null
            }
        });

        if (globalTariff) {
            return res.json({
                tariff: globalTariff,
                source: 'global',
                basePrice: service.price
            });
        }

        // 5. No tariff found
        return res.json({
            price: service.price,
            source: 'not_covered',
            message: 'Prestación no cubierta',
            coverage: 0
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error resolving price' });
    }
};
