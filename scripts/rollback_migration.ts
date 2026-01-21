import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function rollback() {
    console.log('Rolling back migration...');

    const result = await prisma.appointment.deleteMany({
        where: { externalId: { not: null } }
    });

    console.log(`✓ Deleted ${result.count} migrated appointments`);

    await prisma.$disconnect();
}

rollback();
