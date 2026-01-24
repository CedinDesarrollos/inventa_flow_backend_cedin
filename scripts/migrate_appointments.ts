import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

// Professional mapping (old ID -> new UUID)
const PROFESSIONAL_MAP: Record<number, string> = {
    1281436: 'd1904151-3b5a-41e4-88db-ece8bacf0f93', // Dra. Jessica Jara
    1281437: 'b7551f64-0839-4ace-bd89-922005a25e9b', // Dr. Elias Jara
    1281435: 'a6366201-8e91-414c-a9a3-a9af451e3c40', // Dr. Jorge Jara
};

// Fixed IDs
const BRANCH_ID = '37c09813-8da7-4ba9-9134-6ecbb40f915d'; // Cedin Asunción
const SERVICE_ID = '276e8bf9-86fd-4c3e-8868-065b907ec7ab'; // Consulta Médica General

interface LegacyRecord {
    id: number;
    id_organizador: number;
    cedula: string;
    nombre: string;
    email: string;
    numero_telefono: string;
    tipo_reserva: string;
    fecha_inicio: Date;
    hora_inicio: string | Date; // Can be string or Date from PostgreSQL
    fecha_fin: Date;
    hora_fin: string | Date; // Can be string or Date from PostgreSQL
}

// Helper: Parse full name into firstName and lastName
function parseName(fullName: string): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);

    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '' };
    } else if (parts.length === 2) {
        return { firstName: parts[0], lastName: parts[1] };
    } else if (parts.length === 3) {
        return { firstName: parts[0], lastName: `${parts[1]} ${parts[2]}` };
    } else {
        // 4 or more words: first two = firstName, rest = lastName
        return {
            firstName: `${parts[0]} ${parts[1]}`,
            lastName: parts.slice(2).join(' ')
        };
    }
}

// Helper: Combine date and time into DateTime (UTC-aware)
function combineDateAndTime(date: Date, time: string | Date): Date {
    let hours: number, minutes: number, seconds: number;

    if (typeof time === 'string') {
        // Time is a string like "09:00:00"
        [hours, minutes, seconds] = time.split(':').map(Number);
    } else {
        // Time is a Date object (PostgreSQL TIME type returns as Date)
        // IMPORTANT: Use UTC methods to avoid timezone conversion
        hours = time.getUTCHours();
        minutes = time.getUTCMinutes();
        seconds = time.getUTCSeconds();
    }

    // CRITICAL: Use UTC methods to read AND write to avoid any timezone conversion
    // The date from PostgreSQL DATE field comes as midnight UTC
    const combined = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        hours,
        minutes,
        seconds || 0,
        0
    ));

    return combined;
}

// Helper: Calculate duration in minutes
function calculateDuration(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
}

// Helper: Get or create patient
async function getOrCreatePatient(
    cedula: string,
    nombre: string,
    email: string,
    telefono: string,
    dryRun: boolean
): Promise<string | null> {
    // Try to find existing patient by identifier (cedula)
    const existing = await prisma.patient.findFirst({
        where: { identifier: cedula }
    });

    if (existing) {
        console.log(`  ✓ Patient found: ${existing.firstName} ${existing.lastName} (${cedula})`);
        return existing.id;
    }

    // Patient doesn't exist, create new one
    const { firstName, lastName } = parseName(nombre);

    console.log(`  ⚠ Patient NOT found. Creating: ${firstName} ${lastName} (${cedula})`);

    if (dryRun) {
        console.log(`    [DRY-RUN] Would create patient with birthDate=1900-01-01`);
        return null; // Return null in dry-run
    }

    const newPatient = await prisma.patient.create({
        data: {
            firstName,
            lastName,
            identifier: cedula,
            email: email || undefined,
            phone: telefono || undefined,
            birthDate: new Date('1900-01-01'), // Sentinel value for manual review
        }
    });

    console.log(`    ✓ Created patient ID: ${newPatient.id}`);
    return newPatient.id;
}

async function migrateAppointments(dryRun: boolean = true) {
    console.log('='.repeat(80));
    console.log(`MIGRATION MODE: ${dryRun ? 'DRY-RUN (No changes will be made)' : 'LIVE (Changes will be committed)'}`);
    console.log('='.repeat(80));
    console.log('');

    try {
        if (!dryRun) {
            console.log('⚠️  TRUNCATING Appointment table...');
            await prisma.appointment.deleteMany({});
            console.log('✓ Appointment table truncated.');
        }

        // Fetch legacy records
        console.log('📥 Fetching legacy records from reservas_consultas...');
        // Removed filter: WHERE fecha_inicio > '2026-01-01' to migrate EVERYTHING
        const legacyRecords: LegacyRecord[] = await prisma.$queryRaw`
            SELECT 
                id, id_organizador, cedula, nombre, email, numero_telefono,
                tipo_reserva, fecha_inicio, hora_inicio, fecha_fin, hora_fin
            FROM public.reservas_consultas
            WHERE estado_reserva = 'ACCEPTED'
            ORDER BY fecha_inicio, hora_inicio
        `;

        console.log(`✓ Found ${legacyRecords.length} records to migrate\n`);

        let successCount = 0;
        let errorCount = 0;
        const errors: Array<{ record: any; error: string }> = [];

        for (const [index, record] of legacyRecords.entries()) {
            // Log progress every 10 records to avoid spamming
            if (index % 10 === 0) {
                console.log(`[${index + 1}/${legacyRecords.length}] Processing ID: ${record.id}`);
            }

            try {
                // 1. Map professional
                const professionalId = PROFESSIONAL_MAP[record.id_organizador];
                if (!professionalId) {
                    throw new Error(`Unknown professional ID: ${record.id_organizador}`);
                }

                // 2. Get or create patient
                const patientId = await getOrCreatePatient(
                    record.cedula,
                    record.nombre,
                    record.email,
                    record.numero_telefono,
                    dryRun
                );

                // 3. Combine dates and times
                const startDateTime = combineDateAndTime(record.fecha_inicio, record.hora_inicio);
                const endDateTime = combineDateAndTime(record.fecha_fin, record.hora_fin);
                const duration = calculateDuration(startDateTime, endDateTime);

                // 4. Create appointment
                if (dryRun) {
                    // Verbose only for first few in dry run
                    if (index < 5) {
                        console.log(`  [DRY-RUN] Would create appointment for ${record.nombre} at ${startDateTime.toISOString()}`);
                    }
                } else {
                    if (!patientId) {
                        throw new Error('Patient ID is null in live mode');
                    }

                    await prisma.appointment.create({
                        data: {
                            externalId: record.id.toString(),
                            patientId: patientId,
                            doctorId: professionalId,
                            branchId: BRANCH_ID,
                            serviceId: SERVICE_ID,
                            date: startDateTime,
                            endDate: endDateTime,
                            duration: duration,
                            type: 'CONSULTATION',
                            status: 'SCHEDULED', // All migrated are accepted/scheduled
                            legacy_tipoReserva: record.tipo_reserva,
                        }
                    });
                }

                successCount++;

            } catch (error: any) {
                errorCount++;
                const errorMsg = error.message || String(error);
                console.error(`  ✗ ERROR for ID ${record.id}: ${errorMsg}`);
                errors.push({ record, error: errorMsg });
            }
        }

        // Summary
        console.log('\n' + '='.repeat(80));
        console.log('MIGRATION SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total records processed: ${legacyRecords.length}`);
        console.log(`✓ Successful: ${successCount}`);
        console.log(`✗ Errors: ${errorCount}`);

        if (errors.length > 0) {
            console.log('\n❌ ERRORS ENCOUNTERED:');
            errors.slice(0, 10).forEach(({ record, error }, i) => {
                console.log(`\n${i + 1}. Record ID ${record.id} (${record.nombre}):`);
                console.log(`   Error: ${error}`);
            });
            if (errors.length > 10) console.log(`... and ${errors.length - 10} more errors.`);
        }

        if (dryRun) {
            console.log('\n⚠️  DRY-RUN MODE: No changes were made to the database.');
            console.log('   Run with --live to execute the migration.');
        } else {
            console.log('\n✅ LIVE MIGRATION COMPLETED!');
        }

    } catch (error) {
        console.error('\n❌ FATAL ERROR:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Main execution
const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--live');

console.log('\n🚀 Starting Appointment Migration Script\n');

if (isDryRun) {
    console.log('ℹ️  Running in DRY-RUN mode (use --live to execute for real)\n');
}

migrateAppointments(isDryRun)
    .then(() => {
        console.log('\n✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
    });
