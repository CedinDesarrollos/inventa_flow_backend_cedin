import { prisma } from './src/lib/prisma';
import { getAvailableSlots } from './src/controllers/availability.controller';

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

    console.log("=== Testing overlaps for Jessica Jara on 2026-03-27 ===");

    // We know there's an appointment at 16:20Z to 16:40Z in the DB.
    // If we request slots for 2026-03-27:
    const mockReq = {
        query: {
            date: '2026-03-27T00:00:00.000Z',
            professionalId: jessica.id,
            duration: '20'
        }
    } as any;

    let sentSlots: string[] = [];
    const mockRes = {
        json: (data: any) => {
            sentSlots = data;
        },
        status: (code: number) => ({
            json: (err: any) => { console.log("ERROR", code, err) }
        })
    } as any;

    console.log("Calling getAvailableSlots...");
    await getAvailableSlots(mockReq, mockRes);

    // According to face value UTC, if we ask for 2026-03-27 slots, the slot 16:20Z should NOT be available.
    if (sentSlots.includes('2026-03-27T16:20:00.000Z')) {
        console.error("FAIL: Slot 16:20Z is listed as available but it should be overlapping!");
    } else {
        console.log("SUCCESS: Slot 16:20Z is properly excluded from available slots.");
    }
}

main().catch(console.error).finally(() => {
    process.exit(0);
});
