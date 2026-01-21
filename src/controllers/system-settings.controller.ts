import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const CLINIC_CONFIG_KEY = 'CLINIC_CONFIG';

const systemConfigSchema = z.object({
    clinicName: z.string(),
    address: z.string().optional(),
    phone: z.string().optional(),
    taxName: z.string().optional(),
    taxId: z.string().optional(),
    invoiceCode: z.string().optional(),
    timbrado: z.string().optional(),
    timezone: z.string().optional(),
    retentionMonths: z.number().optional().default(6)
});

export const getSettings = async (req: Request, res: Response) => {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: CLINIC_CONFIG_KEY }
        });

        if (!setting) {
            // Return default config if not found
            return res.json({
                clinicName: 'Clínica InventaFlow',
                address: 'Av. Principal 123',
                phone: '+595 981 123 456',
                taxName: 'InventaFlow S.A.',
                taxId: '80012345-6',
                invoiceCode: '001-001',
                timbrado: '15402030',
                timezone: 'America/Asuncion',
                retentionMonths: 6
            });
        }

        res.json(setting.value);
    } catch (error) {
        console.error('Get Settings Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateSettings = async (req: Request, res: Response) => {
    try {
        const data = systemConfigSchema.parse(req.body);

        const setting = await prisma.systemSetting.upsert({
            where: { key: CLINIC_CONFIG_KEY },
            update: { value: data },
            create: {
                key: CLINIC_CONFIG_KEY,
                value: data,
                description: 'Configuración general de la clínica y facturación'
            }
        });

        res.json(setting.value);
    } catch (error) {
        console.error('Update Settings Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};
