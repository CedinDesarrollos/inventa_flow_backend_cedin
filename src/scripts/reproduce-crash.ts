
import { prisma } from '../lib/prisma';
import { z } from 'zod';

// Mocking the behavior of getAppointments controller logic with Zod
const getAppointmentsQuerySchema = z.object({
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
    doctorId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    status: z.string().optional(),
    paymentStatus: z.string().optional()
});

async function testFix() {
    console.log('Starting verification test...');

    const testCases = [
        { name: 'Start/End Missing (Should Default to Month)', query: {} },
        { name: 'Invalid Date (Should Fail Validation)', query: { start: 'invalid' } },
        { name: 'Valid Range', query: { start: new Date().toISOString(), end: new Date().toISOString() } },
    ];

    for (const test of testCases) {
        console.log(`\n--- Testing: ${test.name} ---`);
        try {
            const queryParams = getAppointmentsQuerySchema.parse(test.query);
            const { start, end } = queryParams;

            const where: any = {};

            if (start && end) {
                console.log('Range provided:', start, end);
                where.date = {
                    gte: new Date(start),
                    lte: new Date(end)
                };
            } else {
                console.log('Range MISSING. Simulating default behavior...');
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                where.date = {
                    gte: startOfMonth,
                    lte: endOfMonth
                };
            }

            console.log('Final Where Clause:', JSON.stringify(where, null, 2));

            // Actually run it
            const results = await prisma.appointment.findMany({
                where,
                take: 5 // Just check if it runs
            });
            console.log(`Success! Found ${results.length} records.`);

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.log('Caught Expected Validation Error:', JSON.stringify((error as any).errors, null, 2));
            } else {
                console.error('Caught Unexpected Error:', error);
            }
        }
    }

    console.log('\nVerification completed.');
}

testFix()
    .catch(e => console.error('Unhandled top-level error:', e))
    .finally(async () => {
        await prisma.$disconnect();
    });
