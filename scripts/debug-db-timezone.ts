
import { prisma } from '../src/lib/prisma';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    console.log('--- Debug DB Timezone ---');
    console.log('System Time:', new Date().toISOString(), new Date().toString());

    // Fetch last 5 payments
    const payments = await prisma.payment.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            createdAt: true,
            amount: true
        }
    });

    console.log('--- Last 5 Payments ---');
    payments.forEach(p => {
        console.log(`ID: ${p.id} | Amount: ${p.amount} | CreatedAt (ISO): ${p.createdAt.toISOString()} | CreatedAt (Local): ${p.createdAt.toString()}`);

        // Debug Shift Logic Check
        const hour = p.createdAt.getUTCHours();
        console.log(`   -> UTC Hour: ${hour}`);

        // My Logic: Morning if < 17:00 Z.
        // Afternoon if >= 17:00 Z.
        if (hour < 17 && hour >= 3) console.log('   -> Matches MORNING [03, 17)');
        else if (hour >= 17 || hour < 3) console.log('   -> Matches AFTERNOON [17, 03)');
        else console.log('   -> Gap? [00, 03)');
    });
}

run()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
