import { prisma } from './src/lib/prisma';

/**
 * Migration script to create Payment records for existing COMPLETED transactions
 * and update their amountPaid and balance fields.
 */
async function migrateHistoricalPayments() {
    console.log('Starting historical payments migration...');

    try {
        // Get all COMPLETED transactions
        const completedTxs = await prisma.transaction.findMany({
            where: { status: 'COMPLETED' }
        });

        console.log(`Found ${completedTxs.length} COMPLETED transactions to migrate`);

        let migrated = 0;
        let skipped = 0;

        for (const tx of completedTxs) {
            // Check if payment already exists
            const existingPayment = await prisma.payment.findFirst({
                where: { transactionId: tx.id }
            });

            if (existingPayment) {
                console.log(`Skipping transaction ${tx.id} - payment already exists`);
                skipped++;
                continue;
            }

            // Create Payment record
            await prisma.payment.create({
                data: {
                    transactionId: tx.id,
                    amount: tx.total,
                    paymentMethod: tx.paymentMethod,
                    paymentCode: tx.paymentCode,
                    receiptUrl: tx.paymentReceiptUrl,
                    notes: 'Migrated from historical transaction',
                    createdAt: tx.createdAt,
                    createdBy: tx.authorId
                }
            });

            // Update Transaction
            await prisma.transaction.update({
                where: { id: tx.id },
                data: {
                    amountPaid: tx.total,
                    balance: 0
                }
            });

            migrated++;

            if (migrated % 10 === 0) {
                console.log(`Progress: ${migrated}/${completedTxs.length} transactions migrated`);
            }
        }

        console.log('\n✅ Migration completed successfully!');
        console.log(`   Migrated: ${migrated} transactions`);
        console.log(`   Skipped: ${skipped} transactions (already had payments)`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

migrateHistoricalPayments()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
