import { prisma } from '../src/lib/prisma';

async function main() {
    try {
        const count = await prisma.patient.count();
        console.log(`Total Patients: ${count}`);
    } catch (error) {
        console.error('Error counting:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
