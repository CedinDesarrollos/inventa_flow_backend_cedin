import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function checkProfessionals() {
    const professionals = await prisma.user.findMany({
        where: { role: 'PROFESSIONAL' },
        select: { id: true, fullName: true }
    });

    console.log('Professionals in database:');
    console.log(JSON.stringify(professionals, null, 2));

    await prisma.$disconnect();
}

checkProfessionals();
