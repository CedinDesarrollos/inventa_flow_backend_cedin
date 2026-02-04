import { prisma } from '../src/lib/prisma';

// const prisma = new PrismaClient(); // Removed local instantiation

async function main() {
    console.log('Starting Fix for Pending Particular Transactions...');

    // Define Today's Range (Local Time assumption handled by script execution context or flexible range)
    // To be safe, we'll look at the last 24 hours or specifically today 2026-02-04
    // Using loose boundaries to catch "today"
    const start = new Date('2026-02-04T00:00:00.000'); // Assuming UTC or local overlap is fine if we check author/context
    // Actually, best to rely on system time if it matches user expectation, but explicit date is safer.
    const end = new Date('2026-02-04T23:59:59.999');

    console.log(`Searching between ${start.toISOString()} and ${end.toISOString()}`);

    const transactions = await prisma.transaction.findMany({
        where: {
            createdAt: {
                gte: start,
                lte: end
            },
            status: {
                in: ['PENDING', 'PARTIAL']
            },
            patient: {
                insuranceId: null // Particular
            }
        },
        include: {
            patient: true,
            payments: true
        }
    });

    console.log(`Found ${transactions.length} suspect transactions.`);

    for (const tx of transactions) {
        // Calculate missing amount
        const paidSoFar = tx.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        // Note: tx.amountPaid should match paidSoFar, but we recalculate to be safe
        const missing = Number(tx.total) - paidSoFar;

        if (missing <= 0) {
            console.log(`Transaction ${tx.id} has no missing balance (${missing}). Skipping.`);
            continue;
        }

        console.log(`Fixing Transaction ${tx.id}:`);
        console.log(`  Patient: ${tx.patient.firstName} ${tx.patient.lastName}`);
        console.log(`  Total: ${tx.total}, Paid: ${paidSoFar}, Missing: ${missing}`);

        // 1. Create Payment
        await prisma.payment.create({
            data: {
                transactionId: tx.id,
                amount: missing,
                paymentMethod: tx.paymentMethod, // Assume same method as transaction intent
                notes: 'Auto-fix: Completing full payment',
                createdBy: tx.authorId
            }
        });

        // 2. Update Transaction
        await prisma.transaction.update({
            where: { id: tx.id },
            data: {
                amountPaid: { increment: missing },
                balance: 0,
                status: 'COMPLETED'
            }
        });

        // 3. Update Appointment if linked? 
        if (tx.appointmentId) {
            await prisma.appointment.update({
                where: { id: tx.appointmentId },
                data: { paymentStatus: 'PAID' }
            });
        }

        console.log('  -> FIXED');
    }

    console.log('Done.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
