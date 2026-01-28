
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const getMedications = async (req: Request, res: Response) => {
    try {
        const medications = await prisma.medicationCatalog.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(medications);
    } catch (error) {
        console.error('Error getting medications:', error);
        res.status(500).json({ error: 'Failed to get medications' });
    }
};

export const createMedication = async (req: Request, res: Response) => {
    try {
        const { name, defaultDosage } = req.body;

        // Check if exists
        const existing = await prisma.medicationCatalog.findUnique({
            where: { name }
        });

        if (existing) {
            return res.status(400).json({ error: 'Medication already exists' });
        }

        const medication = await prisma.medicationCatalog.create({
            data: {
                name,
                defaultDose: defaultDosage
            }
        });

        res.status(201).json(medication);
    } catch (error) {
        console.error('Error creating medication:', error);
        res.status(500).json({ error: 'Failed to create medication' });
    }
};
