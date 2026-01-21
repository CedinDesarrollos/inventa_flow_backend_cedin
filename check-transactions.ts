import { prisma } from './src/lib/prisma';

async function checkTransactions() {
    try {
        console.log('Checking all transactions in database...\n');

        const all = await prisma.transaction.findMany({
            select: {
                id: true,
                createdAt: true,
                patientId: true,
                paymentMethod: true,
                total: true,
                status: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 10
        });

        console.log(`Found ${all.length} transactions total:`);
        all.forEach((t, i) => {
            console.log(`${i + 1}. ID: ${t.id.substring(0, 8)}... | Date: ${t.createdAt.toISOString()} | Status: ${t.status} | Total: ${t.total}`);
        });

        console.log('\n---\n');

        // Check for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        console.log(`Checking transactions for today (${today.toISOString()} to ${tomorrow.toISOString()})...\n`);

        const todayTransactions = await prisma.transaction.findMany({
            where: {
                createdAt: {
                    gte: today,
                    lt: tomorrow
                },
                status: 'COMPLETED'
            }
        });

        console.log(`Found ${todayTransactions.length} transactions for today with status COMPLETED`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkTransactions();
