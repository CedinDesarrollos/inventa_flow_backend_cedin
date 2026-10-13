import { DateTime } from 'luxon';

export const CLINIC_TIMEZONE = 'America/Asuncion';

function civilDay(value: string) {
    const day = DateTime.fromISO(value, { zone: CLINIC_TIMEZONE });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !day.isValid || day.toISODate() !== value) {
        throw new RangeError('Fecha inválida: use YYYY-MM-DD');
    }
    return day.startOf('day');
}

export function clinicDateRange(startDate: string, endDate = startDate) {
    const start = civilDay(startDate);
    const end = civilDay(endDate).plus({ days: 1 });
    if (end <= start) throw new RangeError('Rango de fechas inválido');
    return { gte: start.toUTC().toJSDate(), lt: end.toUTC().toJSDate() };
}

export function clinicShiftRange(date: string, shift: string) {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : DateTime.fromISO(date, { zone: CLINIC_TIMEZONE }).setZone(CLINIC_TIMEZONE).toISODate();
    const start = civilDay(key || '');
    const cutoff = start.set({ hour: 14 });
    const end = start.plus({ days: 1 });
    if (!['ALL_DAY', 'MORNING', 'AFTERNOON'].includes(shift)) throw new RangeError('Turno inválido');
    return { gte: (shift === 'AFTERNOON' ? cutoff : start).toUTC().toJSDate(), lt: (shift === 'MORNING' ? cutoff : end).toUTC().toJSDate() };
}

// CashClose.date is a civil-day label stored at UTC midnight, not a payment instant.
export function cashCloseDateRange(date: string) {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : DateTime.fromISO(date, { zone: CLINIC_TIMEZONE }).setZone(CLINIC_TIMEZONE).toISODate();
    civilDay(key || '');
    const start = DateTime.fromISO(key!, { zone: 'UTC' });
    return { gte: start.toJSDate(), lt: start.plus({ days: 1 }).toJSDate() };
}
