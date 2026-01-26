
import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Starting conversation refactoring...');

    // 1. Get all patients with > 1 conversation
    const patients = await prisma.patient.findMany({
        include: {
            conversations: {
                orderBy: { lastMessageAt: 'desc' },
                include: { messages: true }
            }
        }
    });

    for (const patient of patients) {
        if (patient.conversations.length > 1) {
            console.log(`Fixing patient ${patient.firstName} ${patient.lastName} (${patient.conversations.length} conversations)`);

            const [mainConv, ...duplicates] = patient.conversations;

            for (const dup of duplicates) {
                console.log(`  Merging messages from Conv ${dup.id} to Conv ${mainConv.id}`);

                await prisma.conversationMessage.updateMany({
                    where: { conversationId: dup.id },
                    data: { conversationId: mainConv.id }
                });

                // Delete duplicate conversation
                await prisma.conversation.delete({ where: { id: dup.id } });
            }
        }
    }

    console.log('Done.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
