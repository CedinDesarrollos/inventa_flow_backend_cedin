import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z, ZodError } from 'zod';

const branchSchema = z.object({
    name: z.string().min(1, "Name is required"),
    address: z.string().min(1, "Address is required"),
    city: z.string().min(1, "City is required"),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    status: z.enum(['active', 'inactive']).default('active'),
    exhibitColor: z.string().default('bg-blue-100 text-blue-700 border-blue-200'),
    roomsCount: z.number().int().min(0).default(0),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    // Frontend sends 'coordinates', we might need to transform it or just accept lat/long
    coordinates: z.object({
        lat: z.number(),
        lng: z.number()
    }).optional(),
    isMain: z.boolean().default(false)
});

export const getBranches = async (req: Request, res: Response) => {
    try {
        const branches = await prisma.branch.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(branches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
};

export const createBranch = async (req: Request, res: Response) => {
    try {
        // Transform coordinates if present
        const data = req.body;
        console.log('Received Branch Data:', JSON.stringify(data, null, 2));

        if (data.coordinates) {
            data.latitude = data.coordinates.lat;
            data.longitude = data.coordinates.lng;
        }

        const validatedData = branchSchema.parse(data);

        // Remove coordinates object before saving to Prisma (it's not in schema)
        const { coordinates, ...prismaData } = validatedData;

        const branch = await prisma.branch.create({
            data: {
                ...prismaData,
                phone: prismaData.phone || "", // Ensure string if undefined
            }
        });

        res.status(201).json(branch);
    } catch (error) {
        if (error instanceof ZodError) {
            res.status(400).json({ error: (error as any).errors });
        } else {
            console.error(error);
            res.status(500).json({ error: 'Failed to create branch' });
        }
    }
};

export const updateBranch = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const data = req.body;

        if (data.coordinates) {
            data.latitude = data.coordinates.lat;
            data.longitude = data.coordinates.lng;
        }

        // Partial validation for updates
        const validatedData = branchSchema.partial().parse(data);
        const { coordinates, ...prismaData } = validatedData; // Exclude coordinates

        const branch = await prisma.branch.update({
            where: { id: id },
            data: prismaData
        });

        res.json(branch);
    } catch (error) {
        if (error instanceof ZodError) {
            res.status(400).json({ error: (error as any).errors });
        } else {
            console.error(error);
            res.status(500).json({ error: 'Failed to update branch' });
        }
    }
};

export const deleteBranch = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        await prisma.branch.delete({ where: { id: id } });
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete branch' });
    }
};
