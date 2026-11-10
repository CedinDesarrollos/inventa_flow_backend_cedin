import type { Response } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma';
import { userProfileSelect } from '../lib/user-profile';
import type { AuthRequest } from '../middleware/auth.middleware';
import { appointmentHitsOoo, toMinutes, type ExceptionLike } from '../services/schedule/workingWindows';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:mm)');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)').transform(d => new Date(`${d}T00:00:00.000Z`));

class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

const exceptionInclude = {
    professional: { select: { id: true, firstName: true, lastName: true, userId: true } },
    branch: { select: { id: true, name: true } },
    createdBy: { select: { id: true, fullName: true } },
    reviewedBy: { select: { id: true, fullName: true } }
};

const appointmentInclude = {
    patient: true,
    doctor: { select: { ...userProfileSelect, professional: true } },
    branch: true,
    service: true
};

/** manage = aplica cambios; request = solo solicita (queda PENDING). */
async function accessTo(req: AuthRequest, professionalId: string) {
    const professional = await prisma.professional.findUnique({ where: { id: professionalId } });
    if (!professional) throw new HttpError(404, 'Profesional no encontrado');
    const role = req.user?.role;
    if (role === 'ADMIN' || role === 'DEVELOPER') return { professional, access: 'manage' as const };
    if (role === 'PROFESSIONAL' && professional.userId === req.user?.userId) return { professional, access: 'manage' as const };
    if (role === 'SECRETARY') return { professional, access: 'request' as const };
    throw new HttpError(403, 'No tiene permiso para modificar la agenda de este profesional');
}

/** Citas activas que caen dentro de la ausencia (se tratan como "a reagendar"). */
async function affectedBy(userId: string, ooo: ExceptionLike) {
    const appointments = await prisma.appointment.findMany({
        where: {
            doctorId: userId,
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            date: { gte: ooo.dateFrom, lt: new Date(ooo.dateTo.getTime() + 86400000) }
        },
        include: appointmentInclude,
        orderBy: { date: 'asc' }
    });
    return appointments.filter(a => appointmentHitsOoo({ ...ooo, kind: 'OOO', status: 'APPROVED' }, a.date, a.duration));
}

function fail(res: Response, error: unknown) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message ?? 'Datos inválidos' });
    console.error(error);
    return res.status(500).json({ error: 'Error al procesar el horario' });
}

const listSchema = z.object({
    professionalId: z.string().optional(),
    from: day.optional(),
    to: day.optional(),
    kind: z.enum(['SITE', 'OOO']).optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional()
});

export const listExceptions = async (req: AuthRequest, res: Response) => {
    try {
        const q = listSchema.parse(req.query);
        const exceptions = await prisma.scheduleException.findMany({
            where: {
                professionalId: q.professionalId,
                kind: q.kind,
                status: q.status,
                ...(q.from && { dateTo: { gte: q.from } }),
                ...(q.to && { dateFrom: { lte: q.to } })
            },
            include: exceptionInclude,
            orderBy: [{ dateFrom: 'asc' }, { startTime: 'asc' }],
            take: 1000
        });
        res.json(exceptions);
    } catch (error) {
        fail(res, error);
    }
};

const siteDaySchema = z.object({
    professionalId: z.string(),
    date: day,
    windows: z.array(z.object({ branchId: z.string().nullish(), start: time, end: time })).max(12)
});

/** Reemplaza el horario particular de una fecha. windows vacío = vuelve al horario base. */
export const replaceSiteDay = async (req: AuthRequest, res: Response) => {
    try {
        const body = siteDaySchema.parse(req.body);
        const { access } = await accessTo(req, body.professionalId);
        if (access !== 'manage') throw new HttpError(403, 'Solo el profesional o un administrador pueden cargar horarios particulares');
        const sorted = [...body.windows].sort((a, b) => a.start.localeCompare(b.start));
        sorted.forEach((w, i) => {
            if (toMinutes(w.start) >= toMinutes(w.end)) throw new HttpError(400, `La franja ${w.start}-${w.end} termina antes de empezar`);
            if (i > 0 && toMinutes(w.start) < toMinutes(sorted[i - 1].end)) throw new HttpError(400, 'Las franjas no pueden superponerse');
        });
        await prisma.$transaction([
            prisma.scheduleException.deleteMany({
                where: { professionalId: body.professionalId, kind: 'SITE', dateFrom: body.date, dateTo: body.date }
            }),
            prisma.scheduleException.createMany({
                data: sorted.map(w => ({
                    professionalId: body.professionalId,
                    kind: 'SITE',
                    status: 'APPROVED',
                    dateFrom: body.date,
                    dateTo: body.date,
                    startTime: w.start,
                    endTime: w.end,
                    branchId: w.branchId || null,
                    createdById: req.user!.userId
                }))
            })
        ]);
        const saved = await prisma.scheduleException.findMany({
            where: { professionalId: body.professionalId, kind: 'SITE', dateFrom: body.date, dateTo: body.date },
            include: exceptionInclude,
            orderBy: { startTime: 'asc' }
        });
        res.json(saved);
    } catch (error) {
        fail(res, error);
    }
};

const oooSchema = z.object({
    professionalId: z.string(),
    dateFrom: day,
    dateTo: day,
    startTime: time.nullish(),
    endTime: time.nullish(),
    reason: z.string().trim().max(300).nullish(),
    dryRun: z.boolean().optional()
}).refine(o => o.dateFrom <= o.dateTo, 'La fecha hasta debe ser igual o posterior a la fecha desde')
    .refine(o => !o.startTime === !o.endTime, 'Indique hora desde y hasta, o ninguna para el día completo')
    .refine(o => !o.startTime || toMinutes(o.startTime) < toMinutes(o.endTime!), 'La hora hasta debe ser posterior a la hora desde');

/** Crea una ausencia. Secretaría solo la solicita (PENDING). dryRun devuelve los pacientes afectados sin guardar. */
export const createOoo = async (req: AuthRequest, res: Response) => {
    try {
        const body = oooSchema.parse(req.body);
        const { professional, access } = await accessTo(req, body.professionalId);
        const data = {
            professionalId: body.professionalId,
            kind: 'OOO',
            status: access === 'manage' ? 'APPROVED' : 'PENDING',
            dateFrom: body.dateFrom,
            dateTo: body.dateTo,
            startTime: body.startTime ?? null,
            endTime: body.endTime ?? null,
            reason: body.reason || null,
            createdById: req.user!.userId,
            ...(access === 'manage' && { reviewedById: req.user!.userId, reviewedAt: new Date() })
        };
        const affected = await affectedBy(professional.userId, data);
        if (body.dryRun) return res.json({ status: data.status, affected });
        const exception = await prisma.scheduleException.create({ data, include: exceptionInclude });
        res.status(201).json({ exception, affected });
    } catch (error) {
        fail(res, error);
    }
};

const reviewSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullish() });

export const reviewException = async (req: AuthRequest, res: Response) => {
    try {
        const body = reviewSchema.parse(req.body);
        const current = await prisma.scheduleException.findUnique({ where: { id: String(req.params.id) } });
        if (!current) throw new HttpError(404, 'Ausencia no encontrada');
        if (current.status !== 'PENDING') throw new HttpError(409, 'La solicitud ya fue revisada');
        const { professional, access } = await accessTo(req, current.professionalId);
        if (access !== 'manage') throw new HttpError(403, 'Solo el profesional o un administrador pueden aprobar ausencias');
        const exception = await prisma.scheduleException.update({
            where: { id: current.id },
            data: {
                status: body.approve ? 'APPROVED' : 'REJECTED',
                reviewedById: req.user!.userId,
                reviewedAt: new Date(),
                reviewNote: body.note || null
            },
            include: exceptionInclude
        });
        const affected = body.approve ? await affectedBy(professional.userId, exception) : [];
        res.json({ exception, affected });
    } catch (error) {
        fail(res, error);
    }
};

export const deleteException = async (req: AuthRequest, res: Response) => {
    try {
        const current = await prisma.scheduleException.findUnique({ where: { id: String(req.params.id) } });
        if (!current) throw new HttpError(404, 'Registro no encontrado');
        const { access } = await accessTo(req, current.professionalId);
        // Secretaría solo puede retirar sus propias solicitudes pendientes.
        if (access !== 'manage' && !(current.status === 'PENDING' && current.createdById === req.user?.userId)) {
            throw new HttpError(403, 'No tiene permiso para eliminar este registro');
        }
        await prisma.scheduleException.delete({ where: { id: current.id } });
        res.status(204).end();
    } catch (error) {
        fail(res, error);
    }
};

/** Citas activas desde hoy que caen en ausencias aprobadas, con la ausencia que las afecta. */
export const listToReschedule = async (req: AuthRequest, res: Response) => {
    try {
        let professionalId = typeof req.query.professionalId === 'string' && req.query.professionalId ? req.query.professionalId : undefined;
        if (req.user?.role === 'PROFESSIONAL') {
            const own = await prisma.professional.findUnique({ where: { userId: req.user.userId } });
            if (!own) return res.json([]);
            professionalId = own.id;
        }
        const today = new Date(`${DateTime.now().setZone('America/Asuncion').toISODate()}T00:00:00.000Z`);
        const absences = await prisma.scheduleException.findMany({
            where: { kind: 'OOO', status: 'APPROVED', dateTo: { gte: today }, professionalId },
            include: { professional: { select: { userId: true } } }
        });
        const rows = [];
        for (const ooo of absences) {
            const from = ooo.dateFrom < today ? today : ooo.dateFrom;
            for (const appointment of await affectedBy(ooo.professional.userId, { ...ooo, dateFrom: from })) {
                rows.push({
                    ...appointment,
                    absence: { id: ooo.id, reason: ooo.reason, dateFrom: ooo.dateFrom, dateTo: ooo.dateTo, startTime: ooo.startTime, endTime: ooo.endTime }
                });
            }
        }
        const unique = [...new Map(rows.map(r => [r.id, r])).values()].sort((a, b) => a.date.getTime() - b.date.getTime());
        res.json(unique);
    } catch (error) {
        fail(res, error);
    }
};
