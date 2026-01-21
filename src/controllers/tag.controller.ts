import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const tagSchema = z.object({
    name: z.string().min(1, "El nombre es requerido"),
    color: z.string().min(1, "El color es requerido")
});

export const getTags = async (req: Request, res: Response) => {
    try {
        const tags = await prisma.tag.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(tags);
    } catch (error) {
        console.error('Get Tags Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createTag = async (req: Request, res: Response) => {
    try {
        const { name, color } = tagSchema.parse(req.body);

        const existingTag = await prisma.tag.findUnique({
            where: { name }
        });

        if (existingTag) {
            return res.status(400).json({ message: 'Ya existe una etiqueta con este nombre' });
        }

        const tag = await prisma.tag.create({
            data: { name, color }
        });

        res.status(201).json(tag);
    } catch (error) {
        console.error('Create Tag Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteTag = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.tag.delete({
            where: { id }
        });
        res.json({ message: 'Etiqueta eliminada' });
    } catch (error) {
        console.error('Delete Tag Error:', error);
        res.status(500).json({ message: 'Error al eliminar etiqueta' });
    }
};
