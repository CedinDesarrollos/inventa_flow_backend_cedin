import cron from 'node-cron';
import { NpsService } from '../services/nps/NpsService';

export const initNpsCron = () => {
    // Run every 30 minutes
    // This allows us to catch appointments that finished 2-2.5h ago
    cron.schedule('*/30 * * * *', async () => {
        console.log('⏰ Running NPS Trigger Cron...');
        try {
            const service = new NpsService();
            await service.triggerBatch();
        } catch (error) {
            console.error('❌ Error in NPS Cron:', error);
        }
    });

    console.log('✅ NPS Cron initialized (Every 30 mins)');
};
