
import dotenv from 'dotenv';
import { triggerReminderManually } from '../src/jobs/reminderCron';
import { prisma } from '../src/lib/prisma';

// Load env
dotenv.config();

async function run() {
    console.log('🧪 Testing Reminder System...');

    try {
        // 1. Check System Settings
        const config = await prisma.systemSetting.findUnique({ where: { key: 'reminders_enabled' } });
        console.log('⚙️  System Setting "reminders_enabled":', config?.value);

        // 2. Check Campaign
        const campaign = await prisma.automationCampaign.findUnique({ where: { key: 'appointment_reminders' } });
        console.log('📢 Campaign "appointment_reminders":', campaign);

        // 3. Trigger Logic
        console.log('\n🚀 Triggering Logic:');
        await triggerReminderManually();

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
