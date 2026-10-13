import { runtimeConfigErrors } from './config/validation';
import 'dotenv/config';
import { app } from './app';
import { prisma } from './lib/prisma';
import { startReminderCron } from './jobs/reminderCron';
import { initBirthdayCron } from './jobs/birthdayCron';
import { initNpsCron } from './jobs/npsCron';
import { initConversationCleanup } from './jobs/conversationCleanup';

const configErrors = runtimeConfigErrors(process.env);
if (configErrors.length > 0) {
    console.error(`Invalid runtime configuration: ${configErrors.join('; ')}`);
    process.exit(1);
}

const server = app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
    if (process.env.NOTIFICATIONS_ENABLED !== 'false') {
        startReminderCron();
        initBirthdayCron();
        initNpsCron();
    } else {
        console.log('Outbound notification jobs disabled');
    }
    initConversationCleanup();
});

process.on('SIGTERM', () => {
    server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
});
