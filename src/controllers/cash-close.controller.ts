import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { cashCloseSnapshot, sameCashTotals, sumCashPayments, validCashTotals } from '../services/cash-close-totals';
import { prisma } from '../lib/prisma';
import { cashCloseDateRange, clinicShiftRange } from '../lib/clinic-dates';
import { AuthRequest } from '../middleware/auth.middleware';

export const getCashCloseStatus = async (req: Request, res: Response) => {
    try {
        const { date, branchId, shift = 'ALL_DAY' } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        clinicShiftRange(String(date), String(shift));

        const dayRange = cashCloseDateRange(String(date));

        const bId = branchId ? String(branchId) : undefined;
        const shiftType = String(shift);

        console.log('Querying existing close...');
        const existingClose = await prisma.cashClose.findFirst({
            where: {
                date: dayRange,
                shift: shiftType,
                branchId: bId || null
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: {
                closer: {
                    select: { fullName: true }
                }
            }
        });

        const snapshot = await cashCloseSnapshot(prisma, String(date), shiftType);
        const signatures = Array.isArray(existingClose?.signatures) ? existingClose.signatures : [];
        const latest = signatures[signatures.length - 1] as { paymentSnapshot?: { id: string }[] } | undefined;
        // Do not invent receipt membership for historical signatures without evidence.
        const included = Array.isArray(latest?.paymentSnapshot) ? new Set(latest.paymentSnapshot.map(payment => payment.id)) : null;
        const subsequent = included ? snapshot.payments.filter(payment => !included.has(payment.id)) : null;

        res.json({
            close: existingClose,
            liveTotals: snapshot.totals,
            subsequentPayments: subsequent ? { count: subsequent.length, totals: sumCashPayments(subsequent) } : null
        });

    } catch (error: any) {
        if (error instanceof RangeError) return res.status(400).json({ error: error.message });
        console.error('Error getting cash close:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ error: 'Error getting cash close status', details: error.message });
    }
};

export const signCashClose = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { date, branchId, note, totals, shift = 'ALL_DAY' } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        const dayRange = cashCloseDateRange(String(date));
        clinicShiftRange(String(date), String(shift));
        const queryDate = dayRange.gte;
        const bId = branchId || null;
        const shiftType = String(shift);

        if (totals != null && !validCashTotals(totals)) {
            return res.status(400).json({ error: 'Totales inválidos' });
        }

        const result = await prisma.$transaction(async (db) => {
            const scope = JSON.stringify([queryDate.toISOString(), shiftType, bId]);
            await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))::text`;

            const user = await db.user.findUnique({
                where: { id: userId },
                select: { fullName: true, role: true, isActive: true }
            });
            if (!user?.isActive) {
                return { status: 'UNAUTHORIZED' as const };
            }
            const cashClose = await db.cashClose.findFirst({
                where: { date: dayRange, shift: shiftType, branchId: bId },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
            });
            const currentSignatures = Array.isArray(cashClose?.signatures) ? cashClose.signatures : [];
            if (currentSignatures.some(signature => (signature as { userId?: string } | null)?.userId === userId)) {
                return { status: 'ALREADY_SIGNED' as const };
            }
            const snapshot = await cashCloseSnapshot(db, String(date), shiftType);
            const calculatedTotals = snapshot.totals;
            if (totals != null && !sameCashTotals(totals, calculatedTotals)) {
                return { status: 'TOTALS_CHANGED' as const, liveTotals: calculatedTotals };
            }

            const signature = {
                // Preserve existing display labels; never accept the client's claimed role.
                role: user.role === 'SECRETARY' ? 'CAJERO' : user.role === 'PROFESSIONAL' ? 'MEDICO' : user.role,
                userId,
                name: user.fullName,
                timestamp: new Date().toISOString(),
                note: note || '',
                paymentSnapshot: snapshot.payments,
                snapshot: {
                    total: calculatedTotals.total,
                    cash: calculatedTotals.cash,
                    card: calculatedTotals.card,
                    insurance: calculatedTotals.insurance
                }
            };

            if (!cashClose) {
                const createdClose = await db.cashClose.create({
                    data: {
                        date: queryDate, branchId: bId, shift: shiftType, closedBy: userId,
                        totalAmount: calculatedTotals.total, totalCash: calculatedTotals.cash,
                        totalCard: calculatedTotals.card, totalInsurance: calculatedTotals.insurance,
                        signatures: [signature] as any
                    }
                });
                return { status: 'SIGNED' as const, cashClose: createdClose };
            }
            // The initial cut and all preceding signatures are immutable.
            const updatedClose = await db.cashClose.update({
                where: { id: cashClose.id },
                data: {
                    signatures: [...currentSignatures, signature] as any,
                    // A legacy unsigned draft does not yet contain a protected cut.
                    ...(currentSignatures.length === 0 ? {
                        totalAmount: calculatedTotals.total, totalCash: calculatedTotals.cash,
                        totalCard: calculatedTotals.card, totalInsurance: calculatedTotals.insurance,
                        closedBy: userId, closedAt: new Date(signature.timestamp)
                    } : {})
                }
            });
            return { status: 'SIGNED' as const, cashClose: updatedClose };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

        if (result.status === 'UNAUTHORIZED') {
            return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
        }
        if (result.status === 'ALREADY_SIGNED') {
            return res.status(409).json({ code: 'CASH_CLOSE_ALREADY_SIGNED', error: 'Ya has firmado este cierre.' });
        }
        if (result.status === 'TOTALS_CHANGED') {
            return res.status(409).json({
                code: 'CASH_CLOSE_TOTALS_CHANGED',
                error: 'Los importes cambiaron. Revise los totales actualizados antes de firmar.',
                liveTotals: result.liveTotals
            });
        }
        res.json(result.cashClose);

    } catch (error) {
        console.error('Error signing cash close:', error);
        if (error instanceof RangeError) return res.status(400).json({ error: error.message });
        res.status(500).json({ error: 'Error signing cash close' });
    }
};
