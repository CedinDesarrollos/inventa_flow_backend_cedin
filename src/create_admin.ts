import { prisma } from './lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
    const email = 'admin@inventaflow.com';
    const password = 'admin';
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
        where: { email },
        update: {
            passwordHash: hashedPassword,
            role: 'ADMIN'
        },
        create: {
            email,
            username: 'admin',
            rut: '1-9',
            fullName: 'Administrador Sistema',
            passwordHash: hashedPassword,
            role: 'ADMIN'
        }
    });

    console.log('Admin user created:', user);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
