import { prisma } from '../src/lib/prisma';

// const prisma = new PrismaClient(); // Removed

async function main() {
    console.log('Iniciando migración de seguros...');

    try {
        // 1. Leer datos de la tabla antigua (public.seguros)
        // El usuario indicó "public.seguros s", asumimos nombre de columna "nombre"
        // Probamos leer las columnas para estar seguros o simplemente seleccionamos todo
        const oldInsurances: any[] = await prisma.$queryRaw`SELECT * FROM public.seguros`;

        console.log(`Encontrados ${oldInsurances.length} registros en public.seguros.`);

        if (oldInsurances.length > 0) {
            console.log('Ejemplo de registro encontrado:', oldInsurances[0]);
        }

        let count = 0;
        for (const old of oldInsurances) {
            // 2. Mapear y crear en la nueva tabla (Model Insurance)
            // Asumimos que la columna de nombre es 'nombre' o 'name' o similar.
            // El ejemplo impreso ayudará si falla, pero para automatizar usamos 'nombre' si existe, sino lo que parezca nombre inside try/catch per row?
            // El usuario dijo "Nombre (el que está en la tabla)". Asumimos 'nombre'.

            const name = old.nombre || old.name || old.descripcion || "Sin Nombre";

            // Verificar si ya existe por nombre para evitar duplicados?
            const existing = await prisma.insurance.findFirst({
                where: { name: name }
            });

            if (!existing) {
                await prisma.insurance.create({
                    data: {
                        name: name,
                        ruc: "",
                        contactName: "",
                        contactEmail: "",
                        contactPhone: "",
                        coverageType: "seguro_privado",
                        status: "active",
                        requiresAuth: false
                    }
                });
                count++;
                console.log(`Migrado: ${name}`);
            } else {
                console.log(`Omitido (Ya existe): ${name}`);
            }
        }

        console.log(`Migración completada. ${count} seguros nuevos creados.`);

    } catch (error) {
        console.error('Error durante la migración:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
