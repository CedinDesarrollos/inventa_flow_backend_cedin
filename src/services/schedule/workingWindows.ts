// Horario efectivo de un profesional en un día. Las horas son "face value UTC" como el resto de la agenda.
// Capas: base semanal (professionals.working_hours) < días particulares (SITE, reemplazan el día completo) < ausencias (OOO, restan).

export interface BaseEntry { branchId?: string; days?: number[]; start?: string; end?: string; active?: boolean }
export interface ExceptionLike {
    kind: string;
    status: string;
    dateFrom: Date;
    dateTo: Date;
    startTime?: string | null;
    endTime?: string | null;
    branchId?: string | null;
}
export interface TimeWindow { branchId: string | null; start: string; end: string; source: 'base' | 'site' | 'default' }

export const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const covers = (e: ExceptionLike, key: string) => dayKey(e.dateFrom) <= key && key <= dayKey(e.dateTo);

export function baseEntries(workingHours: unknown): BaseEntry[] {
    const list = Array.isArray(workingHours) ? workingHours : workingHours ? [workingHours] : [];
    return list.filter((e): e is BaseEntry => !!e && typeof e === 'object');
}

/** Rango OOO [inicio, fin) en minutos para ese día; null si la ausencia no cubre el día. */
function oooRange(e: ExceptionLike, key: string): [number, number] | null {
    if (e.kind !== 'OOO' || e.status !== 'APPROVED' || !covers(e, key)) return null;
    return [e.startTime ? toMinutes(e.startTime) : 0, e.endTime ? toMinutes(e.endTime) : 24 * 60];
}

/** Franjas de atención del día (day = medianoche UTC). Sin branchId: todas las sedes. */
export function windowsForDay(workingHours: unknown, exceptions: ExceptionLike[], day: Date, branchId?: string): TimeWindow[] {
    const key = dayKey(day);
    const sites = exceptions.filter((e) => e.kind === 'SITE' && e.status === 'APPROVED' && covers(e, key) && e.startTime && e.endTime);
    const base = baseEntries(workingHours);

    let windows: TimeWindow[];
    if (sites.length) {
        windows = sites.map((e) => ({ branchId: e.branchId ?? null, start: e.startTime!, end: e.endTime!, source: 'site' }));
    } else if (!base.some((e) => e.days?.length)) {
        // Profesional sin horario configurado: se mantiene el comportamiento histórico.
        windows = [{ branchId: null, start: '08:00', end: '18:00', source: 'default' }];
    } else {
        windows = base
            .filter((e) => e.active !== false && e.days?.includes(day.getUTCDay()))
            .map((e) => ({ branchId: e.branchId ?? null, start: e.start || '08:00', end: e.end || '18:00', source: 'base' }));
    }
    if (branchId) windows = windows.filter((w) => !w.branchId || w.branchId === branchId);

    for (const e of exceptions) {
        const range = oooRange(e, key);
        if (!range) continue;
        windows = windows.flatMap((w) => {
            const s = toMinutes(w.start), en = toMinutes(w.end);
            const parts: TimeWindow[] = [];
            if (s < range[0]) parts.push({ ...w, end: toHHMM(Math.min(en, range[0])) });
            if (en > range[1]) parts.push({ ...w, start: toHHMM(Math.max(s, range[1])) });
            return parts;
        });
    }
    return windows.filter((w) => toMinutes(w.start) < toMinutes(w.end)).sort((a, b) => a.start.localeCompare(b.start));
}

/** true si una cita (inicio face-value UTC + duración) cae dentro de una ausencia aprobada. */
export function appointmentHitsOoo(e: ExceptionLike, start: Date, duration: number): boolean {
    const range = oooRange(e, dayKey(start));
    if (!range) return false;
    const s = start.getUTCHours() * 60 + start.getUTCMinutes();
    return s < range[1] && s + duration > range[0];
}
