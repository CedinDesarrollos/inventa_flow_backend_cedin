import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Inspecting public.personas...');
    try {
        const personas: any[] = await prisma.$queryRaw`
            SELECT * FROM public.personas LIMIT 1
        `;

        if (personas.length > 0) {
            console.log('Record Structure:', JSON.stringify(personas[0], null, 2));
            console.log('Keys:', Object.keys(personas[0]).join(', '));
        } else {
            console.log('No patients found in public.personas with rol = 3');
            // Try fetching without filter to see structure
            const anyPersona: any[] = await prisma.$queryRaw`
                SELECT * FROM public.personas LIMIT 1
            `;
            if (anyPersona.length > 0) {
                console.log('Sample Persona (Any Role):', Object.keys(anyPersona[0]).join(', '));
            }
        }
    } catch (error) {
        console.error('Error inspecting table:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
