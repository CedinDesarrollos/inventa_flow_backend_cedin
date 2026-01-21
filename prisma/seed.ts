import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('🌱 Starting seed...');

    console.log('🧹 Cleaning database...');
    // Delete in order to avoid Foreign Key constraints
    await prisma.patientTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.clinicalRecord.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.tariff.deleteMany();
    await prisma.patient.deleteMany(); // Depends on Insurance
    await prisma.insurance.deleteMany();
    await prisma.service.deleteMany(); // Depends on Tariff (actually Tariff depends on Service)
    await prisma.professional.deleteMany();
    await prisma.template.deleteMany();
    await prisma.user.deleteMany(); // Last because many things depend on it (via createdBy or doctorId)
    await prisma.branch.deleteMany();
    await prisma.systemSetting.deleteMany();
    await prisma.medicationCatalog.deleteMany();

    console.log('✨ Database cleaned.');

    const passwordHash = await bcrypt.hash('admin123', 10);

    // Create Requested Developer User
    const devUser = await prisma.user.create({
        data: {
            email: 'developer@inventa.com.py',
            username: 'jorge.jara',
            rut: '3531717',
            fullName: 'Jorge Jara',
            passwordHash,
            role: Role.DEVELOPER, // Using the DEVELOPER role as requested
        },
    });

    console.log('👤 Created User:');
    console.log(`   Email: ${devUser.email}`);
    console.log(`   User: ${devUser.username}`);
    console.log(`   Role: ${devUser.role}`);
    console.log(`   Pass: admin123`);

    console.log('✅ Seed finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
