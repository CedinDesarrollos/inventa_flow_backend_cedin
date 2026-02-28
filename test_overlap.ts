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

  // Since frontend stores local time 13:20 as UTC 13:20:
  const strippedDateStartStr = '2026-03-27T13:00:00.000Z';
  const strippedDateEndStr = '2026-03-27T16:00:00.000Z';

  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId: jessica.id,
      date: {
        gte: new Date(strippedDateStartStr),
        lte: new Date(strippedDateEndStr)
      }
    },
    orderBy: { date: 'asc' }
  });

  console.log("Appointments on 2026-03-27 between 13:00 UTC and 16:00 UTC:");
  for (const app of appointments) {
    console.log(`- ${app.id} | Status: ${app.status} | Date: ${app.date.toISOString()} | EndDate: ${app.endDate?.toISOString()} | Duration: ${app.duration}`);
  }
}

main().catch(console.error).finally(() => {
  process.exit(0);
});
