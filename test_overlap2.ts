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

    console.log("Checking exact Prisma query for createAppointment at 13:20 Face Value UTC");

    // Simulate Agenda.tsx Payload
    const start = new Date('2026-03-27T13:20:00.000Z');
    const end = new Date(start.getTime() + 30 * 60000); // 13:50 UTC

    console.log("Start:", start.toISOString());
    console.log("End:", end.toISOString());
    console.log("Doctor id:", jessica.id);

    const overlap = await prisma.appointment.findFirst({
        where: {
            doctorId: jessica.id,
            status: { not: 'CANCELLED' },
            OR: [
                {
                    date: { lt: end },
                    endDate: { gt: start }
                }
            ]
        }
    });

    if (overlap) {
        console.log("OVERLAP FOUND! -> 409");
        console.log(`- ${overlap.id} | Status: ${overlap.status} | Date: ${overlap.date.toISOString()} | EndDate: ${overlap.endDate?.toISOString()} | Duration: ${overlap.duration}`);
    } else {
        console.log("NO OVERLAP. createAppointment would succeed.");
    }
}

main().catch(console.error).finally(() => {
    process.exit(0);
});
