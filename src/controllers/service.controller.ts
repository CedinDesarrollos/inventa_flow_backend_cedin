import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const serviceSchema = z.object({
    code: z.string().min(1, "El código es requerido"),
    name: z.string().min(1, "El nombre es requerido"),
    category: z.string().min(1, "La categoría es requerida"),
    description: z.string().optional(),
    durationMinutes: z.number().int().min(1, "La duración debe ser mayor a 0"),
    price: z.number().min(0, "El precio no puede ser negativo"),
    status: z.enum(['active', 'inactive']).default('active')
});

export const getServices = async (req: Request, res: Response) => {
    try {
        const services = await prisma.service.findMany({
            orderBy: { name: 'asc' }
        });

        // Map for frontend compatibility (durationMinutes -> duration)
        const mappedServices = services.map(s => ({
            ...s,
            duration: s.durationMinutes
        }));

        res.json(mappedServices);
    } catch (error) {
        console.error('Get Services Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createService = async (req: Request, res: Response) => {
    try {
        const data = serviceSchema.parse(req.body);

        // Check if code exists
        const existing = await prisma.service.findUnique({
            where: { code: data.code }
        });

        if (existing) {
            return res.status(400).json({ message: 'El código del servicio ya existe' });
        }

        const service = await prisma.service.create({
            data: {
                ...data,
                price: data.price // Prisma handles number -> Decimal mapping automatically often, but explicit casting is safer? No, input is number.
            }
        });

        res.status(201).json(service);
    } catch (error) {
        console.error('Create Service Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateService = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const data = serviceSchema.parse(req.body);

        // Check Unique Code if changed
        // Find existing service by id to verify
        const currentService = await prisma.service.findUnique({ where: { id } });
        if (!currentService) {
            return res.status(404).json({ message: 'Servicio no encontrado' });
        }

        if (currentService.code !== data.code) {
            const codeExists = await prisma.service.findUnique({ where: { code: data.code } });
            if (codeExists) {
                return res.status(400).json({ message: 'El código del servicio ya existe' });
            }
        }

        const service = await prisma.service.update({
            where: { id },
            data
        });

        res.json(service);
    } catch (error) {
        console.error('Update Service Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Error updating service' });
    }
};

export const deleteService = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        // Soft delete by setting status to inactive?
        // Or actual delete? Schema has NO delete cascade mentions?
        // Let's implement Soft Delete by status = 'inactive' if user 'deletes'? 
        // Or hard delete?
        // Usually services shouldn't be deleted if used in historical records.
        // For now, I'll provide a hard delete endpoint but maybe frontend won't use it.
        // Wait, the status toggle IS the soft delete mechanism usually?
        // I'll provide hard delete for now.

        await prisma.service.delete({ where: { id } });
        res.json({ message: 'Servicio eliminado' });
    } catch (error) {
        console.error('Delete Service Error:', error);
        // Check for foreign key constraints?
        res.status(500).json({ message: 'Error al eliminar servicio' });
    }
};
