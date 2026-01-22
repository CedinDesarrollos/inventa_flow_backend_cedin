import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedReminderSettings() {
    console.log('🌱 Seeding reminder system settings...');

    const settings = [
        {
            key: 'reminder_window_start',
            value: JSON.stringify('09:00'),
            description: 'Hora de inicio para envío de recordatorios (formato HH:mm)'
        },
        {
            key: 'reminder_window_end',
            value: JSON.stringify('18:00'),
            description: 'Hora de fin para envío de recordatorios (formato HH:mm)'
        },
        {
            key: 'reminder_hours_before',
            value: JSON.stringify(24),
            description: 'Horas de anticipación para enviar recordatorio'
        }
    ];

    for (const setting of settings) {
        const existing = await prisma.systemSetting.findUnique({
            where: { key: setting.key }
        });

        if (!existing) {
            await prisma.systemSetting.create({
                data: setting
            });
            console.log(`✅ Created setting: ${setting.key}`);
        } else {
            console.log(`⏭️  Setting already exists: ${setting.key}`);
        }
    }

    console.log('✅ Reminder settings seeded successfully');
}

seedReminderSettings()
    .catch((e) => {
        console.error('❌ Error seeding reminder settings:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
