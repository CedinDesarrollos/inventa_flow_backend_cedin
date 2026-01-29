
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function checkLegacyFreshness() {
    try {
        const result: any[] = await prisma.$queryRaw`
            SELECT MAX(fecha_inicio) as last_date, COUNT(*) as count 
            FROM public.reservas_consultas
        `;
        console.log('Legacy Table Status:');
        console.log(`record_count: ${result[0]?.count}`);
        console.log(`last_appointment_date: ${result[0]?.last_date}`);

        // Also check if there are recent creates in the potentially truncated table (just to see what the script has done so far)
        const currentCount = await prisma.appointment.count();
        console.log(`destionation_appointment_count: ${currentCount}`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkLegacyFreshness();
