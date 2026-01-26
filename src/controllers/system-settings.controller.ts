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
    retentionMonths: z.number().optional().default(6),
    reminders_enabled: z.boolean().optional(),
    reminder_window_start: z.string().optional(),
    reminder_window_end: z.string().optional(),
    reminder_hours_before: z.number().optional()
});

export const getSettings = async (req: Request, res: Response) => {
    try {
        // Fetch all relevant settings
        const keys = [
            'clinicName', 'address', 'phone', 'taxName', 'taxId',
            'invoiceCode', 'timbrado', 'timezone', 'retentionMonths',
            'reminders_enabled', 'reminder_window_start', 'reminder_window_end', 'reminder_hours_before',
            CLINIC_CONFIG_KEY // Keep for legacy fallback if needed
        ];

        const settings = await prisma.systemSetting.findMany({
            where: { key: { in: keys } }
        });

        const config: any = {
            clinicName: 'Clínica InventaFlow',
            address: 'Av. Principal 123',
            phone: '+595 981 123 456',
            taxName: 'InventaFlow S.A.',
            taxId: '80012345-6',
            invoiceCode: '001-001',
            timbrado: '15402030',
            timezone: 'America/Asuncion',
            retentionMonths: 6,
            reminders_enabled: false,
            reminder_window_start: '09:00',
            reminder_window_end: '18:00',
            reminder_hours_before: 24
        };

        // If CLINIC_CONFIG exists, merge it first (legacy)
        const legacyConfig = settings.find(s => s.key === CLINIC_CONFIG_KEY);
        if (legacyConfig && legacyConfig.value) {
            Object.assign(config, legacyConfig.value);
        }

        // Overlay individual keys (priority)
        settings.forEach(s => {
            if (s.key !== CLINIC_CONFIG_KEY) {
                // Parse if value is a string that looks like JSON, or use raw if valid? 
                // SystemSetting.value is Json type usually. 
                // Checks if Prisma schema defines it as Json or String. 
                // Assuming Json based on codebase usage (s.value).
                config[s.key] = s.value;
            }
        });

        res.json(config);
    } catch (error) {
        console.error('Get Settings Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateSettings = async (req: Request, res: Response) => {
    try {
        // Allow partial updates or full? Schema implies required clinicName.
        // Let's assume frontend sends full object.
        const data = systemConfigSchema.parse(req.body);

        // Save each field as an individual key
        const updates = Object.entries(data).map(([key, value]) => {
            return prisma.systemSetting.upsert({
                where: { key },
                update: { value: value as any },
                create: {
                    key,
                    value: value as any,
                    description: `System setting: ${key}`
                }
            });
        });

        // Also update the legacy key for safety until full migration? 
        // Or just stop using it? Let's update it too to be safe.
        updates.push(prisma.systemSetting.upsert({
            where: { key: CLINIC_CONFIG_KEY },
            update: { value: data as any },
            create: {
                key: CLINIC_CONFIG_KEY,
                value: data as any,
                description: 'Legacy Aggregate Config'
            }
        }));

        await prisma.$transaction(updates);

        res.json(data);
    } catch (error) {
        console.error('Update Settings Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};
