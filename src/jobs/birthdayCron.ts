import cron from 'node-cron';
import { BirthdayService } from '../services/reminders/BirthdayService';

/**
 * Initialize Birthday Cron Job
 * Runs every day at 10:00 AM
 */
export const initBirthdayCron = () => {
    // Schedule: 0 10 * * * (Every day at 10:00)
    cron.schedule('0 10 * * *', async () => {
        console.log('🎂 Running Birthday Cron Job...');
        const birthdayService = new BirthdayService();
        await birthdayService.processGreetings();
    }, {
        timezone: "America/Asuncion"
    });

    console.log('✅ Birthday Cron initialized (Schedule: Daily at 10:00 AM)');
};
