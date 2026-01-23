import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class AutomationController {

    // GET /api/automations
    async getAll(req: Request, res: Response) {
        try {
            const automations = await prisma.automationCampaign.findMany({
                orderBy: { name: 'asc' }
            });
            res.json(automations);
        } catch (error) {
            console.error('Error fetching automations:', error);
            res.status(500).json({ error: 'Failed to fetch automations' });
        }
    }

    // PATCH /api/automations/:key
    async toggle(req: Request, res: Response) {
        const { key } = req.params as { key: string };
        const { isEnabled } = req.body;

        if (typeof isEnabled !== 'boolean') {
            return res.status(400).json({ error: 'isEnabled must be a boolean' });
        }

        try {
            const automation = await prisma.automationCampaign.update({
                where: { key },
                data: { isEnabled }
            });

            console.log(`📡 Automation '${key}' toggled to: ${isEnabled}`);
            res.json(automation);
        } catch (error) {
            console.error(`Error toggling automation ${key}:`, error);
            res.status(500).json({ error: 'Failed to update automation' });
        }
    }
}
