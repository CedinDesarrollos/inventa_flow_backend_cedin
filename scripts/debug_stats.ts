import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Checking BILLED appointments...');

    const billed = await prisma.appointment.findFirst({
        where: { status: 'BILLED' },
        select: { id: true, duration: true, date: true, status: true }
    });
    console.log('Sample BILLED Appointment:', billed);

    const arrived = await prisma.appointment.findFirst({
        where: { status: 'ARRIVED' },
        select: { id: true, duration: true, date: true, status: true }
    });
    console.log('Sample ARRIVED Appointment:', arrived);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
