import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('🔄 Iniciando script de apertura de fichas clínicas...');

    // 1. Obtener un doctor para asignar las fichas
    const doctor = await prisma.user.findFirst({
        where: { role: 'PROFESSIONAL' },
    });

    // Fallback if no professional found, try any user
    const fallbackDoctor = doctor || await prisma.user.findFirst();

    if (!fallbackDoctor) {
        console.error('❌ No se encontró ningún usuario (Doctor) para asignar los registros.');
        process.exit(1);
    }

    console.log(`👨‍⚕️  Registros serán asignados a: ${fallbackDoctor.fullName} (${fallbackDoctor.role})`);

    // 2. Obtener todos los pacientes
    const patients = await prisma.patient.findMany({
        include: { clinicalRecords: true }
    });

    console.log(`📋 Procesando ${patients.length} pacientes...`);

    let updatedHistoryCount = 0;
    let createdRecordCount = 0;

    for (const p of patients) {
        // 3. Inicializar Historial Médico (Antecedentes) si es null
        if (!p.medicalHistory) {
            await prisma.patient.update({
                where: { id: p.id },
                data: {
                    medicalHistory: { allergies: [], chronics: [] }
                }
            });
            updatedHistoryCount++;
        }

        // 4. Crear Ficha Clínica de Apertura si no existe ninguna
        if (p.clinicalRecords.length === 0) {
            await prisma.clinicalRecord.create({
                data: {
                    patientId: p.id,
                    doctorId: fallbackDoctor.id,
                    date: new Date(),
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'paragraph',
                                content: [{ type: 'text', text: 'Apertura de ficha clínica (Registro Automático).' }]
                            }
                        ]
                    }
                }
            });
            createdRecordCount++;
        }
    }

    console.log('✅ Proceso finalizado.');
    console.log(`   - Antecedentes inicializados: ${updatedHistoryCount}`);
    console.log(`   - Fichas de apertura creadas: ${createdRecordCount}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
