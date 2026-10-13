require('dotenv/config');
const bcrypt = require('bcrypt');
const { prisma } = require('../dist/lib/prisma');
async function seed() {
    if (process.env.APP_ENV !== 'staging' || process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging') throw new Error('Staging seed refused outside Railway staging');
    if (!process.env.STAGING_PROJECT_ID || process.env.RAILWAY_PROJECT_ID !== process.env.STAGING_PROJECT_ID) throw new Error('Staging seed project identity mismatch');
    if (process.env.NOTIFICATIONS_ENABLED !== 'false') throw new Error('Disable outbound notifications before seeding');
    if (!process.env.STAGING_TEST_PASSWORD || process.env.STAGING_TEST_PASSWORD.length < 16) throw new Error('STAGING_TEST_PASSWORD must be configured');
    const connection = new URL(process.env.DATABASE_URL);
    if (!process.env.STAGING_DATABASE_HOST || connection.hostname !== process.env.STAGING_DATABASE_HOST || !connection.hostname.endsWith('.railway.internal')) throw new Error('Staging seed requires its private Railway database');
    const passwordHash = await bcrypt.hash(process.env.STAGING_TEST_PASSWORD, 12);
    const pinHash = await bcrypt.hash('2468', 12);
    const users = {};
    for (const role of ['ADMIN', 'SECRETARY', 'PROFESSIONAL']) {
        const email = `${role.toLowerCase()}@staging.cedin.invalid`;
        users[role] = await prisma.user.upsert({where: {email}, create: {email, username: `staging.${role.toLowerCase()}`, fullName: `Prueba ${role}`, role, passwordHash, pinHash, mustChangePin: false}, update: {passwordHash, pinHash, isActive: true, mustChangePassword: false, mustChangePin: false}});
    }
    const branch = await prisma.branch.upsert({where: {id: 'a0000000-0000-4000-8000-000000000001'}, create: {id: 'a0000000-0000-4000-8000-000000000001', name: 'Cedin · Sede de prueba', address: 'Datos sintéticos', city: 'Asunción', phone: '', exhibitColor: 'bg-blue-100 text-blue-700 border-blue-200', isMain: true, roomsCount: 2}, update: {}});
    await prisma.professional.upsert({where: {userId: users.PROFESSIONAL.id}, create: {userId: users.PROFESSIONAL.id, firstName: 'Profesional', lastName: 'Prueba', specialty: 'Medicina General', registrationNumber: 'STAGING-ONLY', email: users.PROFESSIONAL.email, color: 'bg-blue-100 text-blue-700 border-blue-200', workingHours: [{branchId: branch.id, days: [0,1,2,3,4,5,6], start: '08:00', end: '20:00'}]}, update: {}});
    await prisma.service.upsert({where: {code: 'STG-CON'}, create: {code: 'STG-CON', name: 'Consulta de prueba', category: 'Consultas', price: 100000, durationMinutes: 30}, update: {}});
    await prisma.patient.upsert({where: {identifier: 'STAGING-PATIENT'}, create: {identifier: 'STAGING-PATIENT', firstName: 'Paciente', lastName: 'Sintético', branchId: branch.id, birthDate: new Date('2000-01-01'), gender: 'M'}, update: {}});
    for (const key of ['reminders_enabled','birthday_enabled','nps_enabled']) await prisma.systemSetting.upsert({where: {key}, create: {key, value: false}, update: {value: false}});
    const [{ssl}] = await prisma.$queryRawUnsafe('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    const [{server_version: version}] = await prisma.$queryRawUnsafe('SHOW server_version');
    if (!ssl) throw new Error('Staging database connection must use TLS');
    if (!version.startsWith('16.')) throw new Error('Staging requires PostgreSQL 16');
    console.log('Synthetic staging data ready; PostgreSQL 16 connection uses TLS.');
}
seed().catch(error => {console.error(error.message);process.exitCode=1;}).finally(() => prisma.$disconnect());
