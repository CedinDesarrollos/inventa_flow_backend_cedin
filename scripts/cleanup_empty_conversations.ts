
import { prisma } from '../src/lib/prisma';

async function cleanup() {
    console.log('🧹 Cleaning up empty conversations...');

    // Find conversations with NO messages
    const emptyConvos = await prisma.conversation.findMany({
        where: {
            messages: {
                none: {}
            }
        },
        include: {
            patient: true
        }
    });

    console.log(`Found ${emptyConvos.length} empty conversations.`);

    for (const conv of emptyConvos) {
        console.log(`Deleting conv ${conv.id} for patient ${conv.patient.firstName}`);
        await prisma.conversation.delete({ where: { id: conv.id } });
    }

    console.log('✅ Cleanup complete.');
}

cleanup()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
