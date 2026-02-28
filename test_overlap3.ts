import { prisma } from './src/lib/prisma';

async function main() {
    const users = await prisma.user.findMany({
        include: { professional: true }
    });

    const jessica = users.find(u =>
        u.professional && (
            u.professional.firstName.toLowerCase().includes('jessica') ||
            u.professional.lastName.toLowerCase().includes('jara')
        )
    );
    if (!jessica) {
        console.log("Jessica Jara not found");
        return;
    }

    const start = new Date('2026-03-27T00:00:00.000Z');
    const end = new Date('2026-03-28T00:00:00.000Z');

    const appts = await prisma.appointment.findMany({
        where: {
            doctorId: jessica.id,
            status: { not: 'CANCELLED' },
            date: { gte: start, lt: end }
        },
        orderBy: { date: 'asc' }
    });

    console.log("ALL appointments on 2026-03-27:");
    for (const a of appts) {
        console.log(`[${a.id}] Date: ${a.date.toISOString()} | EndDate: ${a.endDate?.toISOString() || 'null'} | Duration: ${a.duration}`);
    }
}

main().catch(console.error).finally(() => {
    process.exit(0);
});
