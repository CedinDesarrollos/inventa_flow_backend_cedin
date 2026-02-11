
import { prisma } from '../src/lib/prisma';

async function cleanup() {
    const PATIENT_ID = '380ff16d-c4c4-42ea-bdc5-a63f69ba10b6';

    // Set Time Range for "Today" (2026-02-11)
    const startOfDay = new Date('2026-02-11T00:00:00.000Z');
    const endOfDay = new Date('2026-02-11T23:59:59.999Z');

    console.log(`Cleaning data for Patient: ${PATIENT_ID}`);
    console.log(`Time Range: ${startOfDay.toISOString()} - ${endOfDay.toISOString()}`);

    try {
        // 1. Delete Transactions (Cascades to Items and Payments)
        const { count: txCount } = await prisma.transaction.deleteMany({
            where: {
                patientId: PATIENT_ID,
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });
        console.log(`Deleted ${txCount} transactions (and related items/payments).`);

        // 2. Delete Appointments
        const { count: aptCount } = await prisma.appointment.deleteMany({
            where: {
                patientId: PATIENT_ID,
                date: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });
        console.log(`Deleted ${aptCount} appointments.`);

        // 3. Delete Clinical Records created today (just in case)
        const { count: recordCount } = await prisma.clinicalRecord.deleteMany({
            where: {
                patientId: PATIENT_ID,
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });
        console.log(`Deleted ${recordCount} clinical records.`);


    } catch (error) {
        console.error('Error during cleanup:', error);
    } finally {
        await prisma.$disconnect();
    }
}

cleanup();
