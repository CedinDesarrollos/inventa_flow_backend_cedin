import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Iniciando migración de pacientes...');

    // Default Branch ID (Cedin Asunción)
    const DEFAULT_BRANCH_ID = '37c09813-8da7-4ba9-9134-6ecbb40f915d';

    try {
        // 1. Fetch old personas (patients)
        const oldPatients: any[] = await prisma.$queryRaw`
            SELECT * FROM public.personas WHERE rol_id = 3
        `;

        console.log(`Encontrados ${oldPatients.length} pacientes antiguos.`);

        // 2. Pre-fetch Insurances to map names to IDs
        const newInsurances = await prisma.insurance.findMany();
        // Map: Lowercase Name -> ID
        const insuranceMap = new Map(newInsurances.map(i => [i.name.toLowerCase(), i.id]));

        let count = 0;
        let skipped = 0;
        let warnings: string[] = [];

        for (const p of oldPatients) {
            // Mappings
            const firstName = p.nombre || 'Sin Nombre';
            const lastName = p.apellido || 'Sin Apellido';
            const identifier = p.cedula || `NO-ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`; // Fallback if missing
            const email = p.correo || null;
            const phone = p.celular || null;
            let birthDate = p.fecha_nacimiento ? new Date(p.fecha_nacimiento) : null;

            // Validate Date (Check for Invalid Date or Out of Range)
            if (birthDate) {
                const year = birthDate.getFullYear();
                if (isNaN(year) || year < 1900 || year > new Date().getFullYear()) {
                    // console.log(`Fecha inválida para ${identifier}: ${p.fecha_nacimiento}. Se guardará como null.`);
                    birthDate = null;
                }
            }

            // Insurance Mapping
            let insuranceId = null;
            if (p.seguro_id) {
                // We need to know the NAME of the old insurance to map it.
                // Since we don't have the old insurance table mapping handy in specific logic here,
                // we can attempt a query if needed, OR we rely on the fact that we migrated them
                // and maybe the old table had names we can guess?
                // Actually, the user said "Leeremos seguro_id... Buscaremos el nombre del seguro antiguo...".
                // We need to fetch that name from public.seguros using segur_id.
                try {
                    const oldInsurances: any[] = await prisma.$queryRaw`
                        SELECT nombre FROM public.seguros WHERE id = ${p.seguro_id}
                    `;
                    if (oldInsurances.length > 0 && oldInsurances[0].nombre) {
                        const oldName = oldInsurances[0].nombre.toLowerCase();
                        // Find match in new map (approximate?)
                        // We will try exact match first
                        if (insuranceMap.has(oldName)) {
                            insuranceId = insuranceMap.get(oldName);
                        } else {
                            // Try partial? Or just log warning.
                            // The migration of insurances kept the names, so exact match should work 
                            // if names were migrated as is.
                            warnings.push(`Seguro no encontrado en nueva base: ${oldInsurances[0].nombre} para paciente ${identifier}`);
                        }
                    }
                } catch (err) {
                    // Ignore lookup error
                }
            }

            // Check existence by identifier (RUT/CI)
            const existing = await prisma.patient.findUnique({
                where: { identifier: identifier }
            });

            if (!existing) {
                await prisma.patient.create({
                    data: {
                        firstName,
                        lastName,
                        identifier,
                        email,
                        phone,
                        birthDate,
                        insuranceId: insuranceId ?? undefined,
                        branchId: DEFAULT_BRANCH_ID // Assign default branch
                    }
                });
                count++;
            } else {
                skipped++;
            }
        }

        console.log(`Migración finalizada.`);
        console.log(`Creados: ${count}`);
        console.log(`Omitidos (Ya existen): ${skipped}`);
        if (warnings.length > 0) {
            console.log('Advertencias:', warnings);
        }

    } catch (error) {
        console.error('Error migrando pacientes:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
