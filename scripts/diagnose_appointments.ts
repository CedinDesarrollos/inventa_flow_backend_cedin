
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function diagnose() {
    console.log('Diagnostic initiated...');

    try {
        const appointmentCount = await prisma.appointment.count();
        console.log(`Current Appointment count: ${appointmentCount}`);

        const legacyCount: any[] = await prisma.$queryRaw`
            SELECT COUNT(*)::int as count FROM public.reservas_consultas
        `;
        console.log(`Legacy reserves count: ${legacyCount[0]?.count}`);

        // Check if there are accepted reserves (source of migration)
        const legacyAccepted: any[] = await prisma.$queryRaw`
            SELECT COUNT(*)::int as count 
            FROM public.reservas_consultas
            WHERE estado_reserva = 'ACCEPTED'
        `;
        console.log(`Legacy reserves (ACCEPTED) count: ${legacyAccepted[0]?.count}`);

    } catch (e) {
        console.error('Error querying database:', e);
    } finally {
        await prisma.$disconnect();
    }
}

diagnose();
