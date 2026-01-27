
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
    const doctorId = 'd1904151-3b5a-41e4-88db-ece8bacf0f93';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log(`Checking appointments for Doctor ${doctorId} between ${today.toISOString()} and ${tomorrow.toISOString()}`);

    const appointments = await prisma.appointment.findMany({
        where: {
            doctorId: doctorId,
            date: {
                gte: today,
                lt: tomorrow
            }
        },
        include: {
            patient: true
        }
    });

    console.log(`Found ${appointments.length} appointments.`);
    appointments.forEach(apt => {
        console.log(`- [${apt.status}] ${apt.patient.firstName} ${apt.patient.lastName} (${apt.date.toISOString()})`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
