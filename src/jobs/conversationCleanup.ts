import cron from 'node-cron';
import { prisma } from '../lib/prisma';

export const initConversationCleanup = () => {
    // Run every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        console.log('Running conversation cleanup...');

        try {
            // Calculate cutoff time (1 hour ago)
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

            // Find and close conversations
            const result = await prisma.conversation.updateMany({
                where: {
                    status: 'open',
                    lastMessageAt: {
                        lt: oneHourAgo
                    }
                },
                data: {
                    status: 'closed'
                }
            });

            if (result.count > 0) {
                console.log(`Auto-closed ${result.count} inactive conversations.`);
            }
        } catch (error) {
            console.error('Error during conversation cleanup:', error);
        }
    });

    console.log('Conversation cleanup job initialized (Every 5 mins).');
};
