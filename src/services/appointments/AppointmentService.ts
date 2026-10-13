import { Appointment, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export class AppointmentError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

export function appointmentEnd(date: Date, duration: number): Date {
    const end = new Date(date.getTime() + duration * 60000);
    if (!Number.isFinite(end.getTime())) throw new AppointmentError(400, 'Intervalo de cita inválido');
    return end;
}

async function lockDoctors(tx: Prisma.TransactionClient, doctors: (string | null | undefined)[]) {
    // Every scheduling writer locks the same keys; sorted transfers avoid deadlocks.
    for (const doctorId of [...new Set(doctors.filter((id): id is string => Boolean(id)))].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${doctorId}, 0))`;
    }
}

async function checkOverlap(tx: Prisma.TransactionClient, appointment: {
    doctorId?: string | null; date: Date; duration: number; status: string; isOverbooking: boolean;
}, excludeId = '') {
    // Preserve the existing explicit overbooking and walk-in (CONFIRMED) exceptions.
    if (!appointment.doctorId || appointment.isOverbooking || appointment.status !== 'SCHEDULED') return;
    const end = appointmentEnd(appointment.date, appointment.duration);
    // Derive legacy intervals from duration too: null/stale end_date cannot hide collisions.
    const overlaps = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM inventa_clinical_app.appointments
        WHERE doctor_id = ${appointment.doctorId} AND status <> 'CANCELLED'
          AND id <> ${excludeId} AND date < ${end}
          AND date + duration * interval '1 minute' > ${appointment.date}
        LIMIT 1
    `;
    if (overlaps.length) throw new AppointmentError(409, 'El profesional ya tiene una cita en ese horario.');
}

export function createAppointmentSafely(data: Prisma.AppointmentUncheckedCreateInput & {
    date: Date; duration: number; status: Appointment['status']; isOverbooking: boolean;
}) {
    return prisma.$transaction(async tx => {
        await lockDoctors(tx, [data.doctorId]);
        await checkOverlap(tx, data);
        return tx.appointment.create({
            data: { ...data, endDate: appointmentEnd(data.date, data.duration) },
            include: { patient: true }
        });
    });
}

export function updateAppointmentSafely(id: string, data: Partial<Pick<Appointment,
    'patientId' | 'doctorId' | 'branchId' | 'serviceId' | 'date' | 'duration' | 'type' | 'status' |
    'reason' | 'notes' | 'isOverbooking' | 'secretaryNote' | 'updatedAt' | 'completedAt' | 'startedAt'
>>, professionalId?: string) {
    return prisma.$transaction(async tx => {
        // Re-read after a row lock so simultaneous partial edits cannot lose interval changes.
        await tx.$queryRaw`SELECT id FROM inventa_clinical_app.appointments WHERE id = ${id} FOR UPDATE`;
        const current = await tx.appointment.findUnique({ where: { id } });
        if (!current) throw new AppointmentError(404, 'Cita no encontrada');
        const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        const effective = { ...current, ...changes } as Appointment;
        if (professionalId && (current.doctorId !== professionalId || effective.doctorId !== professionalId)) {
            throw new AppointmentError(403, 'Solo puede gestionar su propia agenda');
        }
        await lockDoctors(tx, [current.doctorId, effective.doctorId]);
        const intervalChanged = effective.date.getTime() !== current.date.getTime() || effective.duration !== current.duration;
        const availabilityChanged = intervalChanged || effective.doctorId !== current.doctorId ||
            effective.status !== current.status || effective.isOverbooking !== current.isOverbooking;
        if (availabilityChanged) await checkOverlap(tx, effective, id);
        return tx.appointment.update({
            where: { id },
            data: { ...changes, ...(intervalChanged ? { endDate: appointmentEnd(effective.date, effective.duration) } : {}) }
        });
    });
}
