import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('🌱 Seeding automation campaigns...');

    const campaigns = [
        {
            key: 'appointment_reminders',
            name: 'Recordatorios de Citas',
            description: 'Envío automático de recordatorios por WhatsApp 24hs antes de una cita.',
            isEnabled: true
        },
        {
            key: 'birthday_greetings',
            name: 'Saludos de Cumpleaños',
            description: 'Envío automático de saludos de cumpleaños a las 10:00 AM.',
            isEnabled: false
        }
    ];

    for (const data of campaigns) {
        const campaign = await prisma.automationCampaign.upsert({
            where: { key: data.key },
            update: {}, // Don't overwrite if exists to preserve user preference
            create: data
        });
        console.log(`✅ Upserted campaign: ${campaign.name} (${campaign.key})`);
    }

    console.log('✨ Seed completed successfully');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
