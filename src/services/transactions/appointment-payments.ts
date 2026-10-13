import type { Prisma } from '@prisma/client';

export class BillingError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

// Billing writers lock appointment then transaction, so simultaneous collections
// cannot leave a stale agenda state or read the same outstanding balance twice.
export async function lockBillingAppointment(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM inventa_clinical_app.appointments WHERE id = ${id} FOR UPDATE`;
    const appointment = await tx.appointment.findUnique({ where: { id } });
    if (!appointment) throw new BillingError(404, 'Cita no encontrada');
    return appointment;
}

export async function lockBillingTransaction(tx: Prisma.TransactionClient, id: string) {
    const before = await tx.transaction.findUnique({ where: { id } });
    if (!before) throw new BillingError(404, 'Transacción no encontrada');
    if (before.appointmentId) await lockBillingAppointment(tx, before.appointmentId);
    await tx.$queryRaw`SELECT id FROM inventa_clinical_app.transactions WHERE id = ${id} FOR UPDATE`;
    const current = await tx.transaction.findUnique({ where: { id } });
    if (!current) throw new BillingError(404, 'Transacción no encontrada');
    if (before.appointmentId !== current.appointmentId) throw new BillingError(409, 'La relación con la cita cambió; reintente el cobro');
    return current;
}

export async function syncAppointmentPayments(tx: Prisma.TransactionClient, appointmentId: string) {
    const accounts = await tx.transaction.findMany({ where: { appointmentId, status: { not: 'VOIDED' } }, select: { balance: true, amountPaid: true } });
    const settled = accounts.length > 0 && accounts.every(account => account.balance.isZero());
    const hasPaid = accounts.some(account => account.amountPaid.gt(0));
    await tx.appointment.update({ where: { id: appointmentId }, data: { paymentStatus: settled ? 'PAID' : hasPaid ? 'PARTIAL' : 'PENDING' } });
}
