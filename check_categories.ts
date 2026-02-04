import { prisma } from './src/lib/prisma';

async function main() {
    const categories = await prisma.costCategory.findMany({
        where: { isActive: true },
    });
    console.log('Active Categories:', categories);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
