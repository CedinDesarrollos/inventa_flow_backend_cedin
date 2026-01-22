import cron from 'node-cron';
import { ReminderService } from '../services/reminders/ReminderService';

const reminderService = new ReminderService();

/**
 * Start the appointment reminder cron job
 * Runs every hour at minute 0
 */
export const startReminderCron = () => {
    // Run every hour at the top of the hour (0 * * * *)
    cron.schedule('0 * * * *', async () => {
        const now = new Date().toISOString();
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔔 Appointment Reminder Cron Job - ${now}`);
        console.log(`${'='.repeat(60)}\n`);

        try {
            await reminderService.processReminders();
            console.log('\n✅ Cron job completed successfully\n');
        } catch (error) {
            console.error('\n❌ Cron job failed:', error);
            console.error('\n');
        }
    });

    console.log('✅ Appointment reminder cron job started');
    console.log('📅 Schedule: Every hour at minute 0');
    console.log('🎯 Dual strategy:');
    console.log('   - Normal hours: Send reminders 23-25 hours before appointment');
    console.log('   - 6:00 PM: Batch send all reminders for tomorrow');
    console.log('');
};

/**
 * Manually trigger reminder processing (for testing)
 */
export const triggerReminderManually = async () => {
    console.log('🔧 Manually triggering reminder processing...\n');
    await reminderService.processReminders();
};
