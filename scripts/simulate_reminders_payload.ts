
import { DateTime } from 'luxon';

// Mock Data provided by user
const appointments = [
    {
        id: '1',
        patient: { firstName: 'Juan', lastName: 'Perez', phone: '+595981111222' },
        doctor: { professional: { prefix: 'Dr.', firstName: 'Roberto', lastName: 'Gomez' } },
        branch: { name: 'Sede Central' },
        date: new Date('2026-01-27T08:20:00.000Z'), // 08:20 Visual Time (stored as UTC)
    },
    {
        id: '2',
        patient: { firstName: 'Maria', lastName: 'Gonzalez', phone: '+595981333444' },
        doctor: { professional: { prefix: 'Dra.', firstName: 'Laura', lastName: 'Martinez' } },
        branch: { name: 'Sede Central' },
        date: new Date('2026-01-27T08:40:00.000Z'), // 08:40 Visual Time
    },
    {
        id: '3',
        patient: { firstName: 'Carlos', lastName: 'Lopez', phone: '+595981555666' },
        doctor: { professional: { prefix: 'Dr.', firstName: 'Jorge', lastName: 'Jara' } },
        branch: { name: 'Sede Central' },
        date: new Date('2026-01-27T09:00:00.000Z'), // 09:00 Visual Time
    }
];

// FIX: Use UTC to preserve the visual time
const TIMEZONE = 'UTC';

// Format Logic (Updated to match ReminderService.ts)
function formatParams(appointment: any) {
    const { patient, doctor, branch, date } = appointment;

    // {{1}} = Patient name
    const patientName = `${patient.firstName} ${patient.lastName}`;

    // {{2}} = Day and date
    const appointmentDate = DateTime.fromJSDate(date)
        .setZone(TIMEZONE) // Now UTC
        .setLocale('es')
        .toFormat("cccc d 'de' MMMM");

    // {{3}} = Time
    const appointmentTime = DateTime.fromJSDate(date)
        .setZone(TIMEZONE) // Now UTC
        .toFormat('hh:mm a');

    // {{4}} = Professional
    const professional = doctor?.professional;
    let professionalName = 'el Dr. Desconocido';
    if (professional) {
        const prefix = professional.prefix || 'el Dr.';
        professionalName = `${prefix} ${professional.firstName} ${professional.lastName}`;
    }

    // {{5}} = Branch name
    const branchName = branch?.name || 'Nuestra clínica';

    return {
        patientName,
        appointmentDate,
        appointmentTime,
        professionalName,
        branchName
    };
}

console.log(`\n🌍 Simulation Config (UPDATED):`);
console.log(`Timezone: ${TIMEZONE} (Visual Sync)`);
console.log(`\n📋 Processing 3 Examples with FIX:\n`);

appointments.forEach((apt, index) => {
    const result = formatParams(apt);
    console.log(`--- Example ${index + 1} ---`);
    console.log(`Input Date (UTC/DB): ${apt.date.toISOString()}`);
    console.log(`\n📨 MESSAGE PREVIEW:`);
    console.log(`"Hola ${result.patientName}, le recordamos su cita para el ${result.appointmentDate} a las ${result.appointmentTime} con ${result.professionalName} en ${result.branchName}."`);
    console.log(`-----------------------------------\n`);
});
