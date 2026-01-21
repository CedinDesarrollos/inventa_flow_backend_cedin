import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const insuranceSchema = z.object({
    name: z.string().min(1, "El nombre es requerido"),
    ruc: z.string().optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().email("Email inválido").optional().or(z.literal('')),
    contactPhone: z.string().optional(),
    coverageType: z.string().min(1), // enum?
    status: z.enum(['active', 'inactive']).default('active'),
    requiresAuth: z.boolean().default(false)
});

export const getInsurances = async (req: Request, res: Response) => {
    try {
        const insurances = await prisma.insurance.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(insurances);
    } catch (error) {
        console.error('Get Insurances Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createInsurance = async (req: Request, res: Response) => {
    try {
        const data = insuranceSchema.parse(req.body);
        const insurance = await prisma.insurance.create({ data });
        res.status(201).json(insurance);
    } catch (error) {
        console.error('Create Insurance Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateInsurance = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const data = insuranceSchema.parse(req.body);
        const insurance = await prisma.insurance.update({
            where: { id },
            data
        });
        res.json(insurance);
    } catch (error) {
        console.error('Update Insurance Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Error updating insurance' });
    }
};

export const deleteInsurance = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        // Hard delete? Or soft delete via status? 
        // User asked "Inactivar" for templates, probably similar here.
        // But let's check if UI has delete button. 
        // We will implement Prisma delete for now.
        await prisma.insurance.delete({ where: { id } });
        res.json({ message: 'Seguro eliminado' });
    } catch (error) {
        console.error('Delete Insurance Error:', error);
        res.status(500).json({ message: 'Error al eliminar seguro' });
    }
};

// Tariffs endpoints
export const getInsuranceTariffs = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const tariffs = await prisma.tariff.findMany({
            where: { insuranceId: id }
        });
        res.json(tariffs);
    } catch (error) {
        console.error('Get Tariffs Error:', error);
        res.status(500).json({ message: 'Error fetching tariffs' });
    }
};

const tariffBatchSchema = z.array(z.object({
    serviceId: z.string(),
    coverageType: z.enum(['fixed', 'percentage']),
    value: z.number().min(0)
}));

export const updateInsuranceTariffs = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string; // Insurance ID
        const tariffsData = tariffBatchSchema.parse(req.body);

        // Transaction to update/upsert tariffs
        // We delete existing for this insurance and re-insert? Or Upsert?
        // Upsert is safer but deleting all and re-inserting is easier if we send the full list.
        // But maybe we only send CHANGED ones?
        // Let's assume we use upsert per item.

        const results = await prisma.$transaction(
            tariffsData.map(t =>
                prisma.tariff.upsert({
                    where: {
                        insuranceId_serviceId: {
                            insuranceId: id,
                            serviceId: t.serviceId
                        }
                    },
                    update: {
                        coverageType: t.coverageType,
                        value: t.value
                    },
                    create: {
                        insuranceId: id,
                        serviceId: t.serviceId,
                        coverageType: t.coverageType,
                        value: t.value
                    }
                })
            )
        );

        res.json(results);
    } catch (error) {
        console.error('Update Tariffs Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Error updating tariffs' });
    }
};
