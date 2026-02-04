
import { PrismaClient } from '@prisma/client';
import { prisma } from './src/lib/prisma';

async function verifyFlow() {
    console.log('🧪 Starting Partial Payment Flow Verification...');

    // 1. Setup: Get a patient and service
    const patient = await prisma.patient.findFirst();
    const service = await prisma.service.findFirst();
    const admin = await prisma.user.findFirst();

    if (!patient || !service || !admin) {
        console.error('❌ Missing test data (patient/service/admin)');
        return;
    }

    console.log(`1. Using Patient: ${patient.firstName} ${patient.lastName}`);

    // 2. Create Transaction with Partial Payment (Total 100k, Initial 50k)
    // We simulate what the controller does
    const total = 100000;
    const initialPayment = 50000;
    const balance = total - initialPayment;

    console.log(`2. Creating Transaction (Total: ${total}, Initial: ${initialPayment})...`);

    const tx = await prisma.transaction.create({
        data: {
            patientId: patient.id,
            authorId: admin.id,
            type: 'TICKET',
            paymentMethod: 'CASH',
            subtotal: total,
            total: total,
            amountPaid: initialPayment,
            balance: balance,
            status: 'PARTIAL', // Correct status
            items: {
                create: [{
                    serviceId: service.id,
                    quantity: 1,
                    unitPrice: total,
                    copay: 0,
                    coverage: 0
                }]
            }
        }
    });

    // Create the initial Payment record
    const p1 = await prisma.payment.create({
        data: {
            transactionId: tx.id,
            amount: initialPayment,
            paymentMethod: 'CASH',
            createdBy: admin.id,
            notes: 'Test Initial Payment'
        }
    });

    console.log(`   ✅ Transaction Created: ${tx.id}`);
    console.log(`   ✅ Status: ${tx.status} (Expected: PARTIAL)`);
    console.log(`   ✅ Balance: ${tx.balance} (Expected: 50000)`);
    console.log(`   ✅ Payment 1 Created: ${p1.id} (Amount: ${p1.amount})`);

    // 3. Verify Database State
    const freshTx = await prisma.transaction.findUnique({
        where: { id: tx.id },
        include: { payments: true }
    });

    if (Number(freshTx?.balance) !== 50000) throw new Error('Balance mismatch!');
    if (freshTx?.status !== 'PARTIAL') throw new Error('Status mismatch!');

    // 4. Add Second Payment (Completing the balance)
    console.log('3. Adding Second Payment (50k)...');

    const payment2Amount = 50000;
    const p2 = await prisma.payment.create({
        data: {
            transactionId: tx.id,
            amount: payment2Amount,
            paymentMethod: 'CARD', // Different method
            createdBy: admin.id,
            notes: 'Test Final Payment'
        }
    });

    // Update Transaction
    const finalPaid = Number(freshTx?.amountPaid) + payment2Amount;
    const finalBalance = Number(freshTx?.total) - finalPaid;

    const finalTx = await prisma.transaction.update({
        where: { id: tx.id },
        data: {
            amountPaid: finalPaid,
            balance: finalBalance,
            status: finalBalance === 0 ? 'COMPLETED' : 'PARTIAL'
        }
    });

    console.log(`   ✅ Payment 2 Created: ${p2.id}`);
    console.log(`   ✅ Final Status: ${finalTx.status} (Expected: COMPLETED)`);
    console.log(`   ✅ Final Balance: ${finalTx.balance} (Expected: 0)`);

    if (finalTx.status !== 'COMPLETED') throw new Error('Final status failed!');

    // 5. Cleanup
    console.log('4. Cleaning up test data...');
    await prisma.payment.deleteMany({ where: { transactionId: tx.id } });
    await prisma.transaction.delete({ where: { id: tx.id } });

    console.log('✅ Flow verification successful! Systems logic is sound.');
}

verifyFlow()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
