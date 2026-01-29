
import { prisma } from '../src/lib/prisma';

async function main() {
    console.log("Starting Debug Script...");

    // 1. Get an Insurance and Service (Assuming some exist)
    const insurance = await prisma.insurance.findFirst();
    const service = await prisma.service.findFirst();

    if (!insurance || !service) {
        console.error("Oops, need insurance and service to test");
        return;
    }

    console.log(`Using Insurance: ${insurance.id}, Service: ${service.id}`);

    // 2. Try findFirst with professionalId: null
    try {
        console.log("Attempting findFirst with professionalId: null");
        const existing = await prisma.tariff.findFirst({
            where: {
                insuranceId: insurance.id,
                serviceId: service.id,
                professionalId: null
            }
        });
        console.log("Found Global Tariff:", existing);

        if (existing) {
            console.log("Attempting Update by ID...");
            await prisma.tariff.update({
                where: { id: existing.id },
                data: { value: 9999 }
            });
            console.log("Update Success");
        } else {
            console.log("Creating Global Tariff...");
            await prisma.tariff.create({
                data: {
                    insuranceId: insurance.id,
                    serviceId: service.id,
                    professionalId: null,
                    value: 5555,
                    coverageType: 'fixed'
                }
            });
            console.log("Create Success");
        }

    } catch (error) {
        console.error("Test Failed:", error);
    }

    // 3. Try Upsert with professionalId: "null" (String) just in case
    // Note: Schema expects string | null. "null" string is technically valid IF the ID was "null", but validation usually blocks this.
    // We already cast to 'any' in the controller, so let's see what happens if we pass "null" string just to see.
    // (This part might act weird if 'null' isn't a valid UUID, but let's test)

}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
