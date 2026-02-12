
import { prisma } from '../lib/prisma';

async function resetWhatsApp() {
    console.log('🗑️  Clearing WhatsApp Session Data...');
    try {
        const { count } = await prisma.baileysSession.deleteMany({});
        console.log(`✅  Successfully deleted ${count} session records.`);
        console.log('🔄  Please restart the backend and scan the QR code again.');
    } catch (error) {
        console.error('❌  Error clearing session data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

resetWhatsApp();
