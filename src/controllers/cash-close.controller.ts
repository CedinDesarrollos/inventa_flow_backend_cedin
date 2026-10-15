import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { cashCloseTotals, sameCashTotals, validCashTotals } from '../services/cash-close-totals';
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
                ...(bId ? { branchId: bId } : {})
            },
            include: {
                closer: {
                    select: { fullName: true }
                }
            }
        });

        const liveTotals = await cashCloseTotals(prisma, String(date), shiftType);

        res.json({
            close: existingClose,
            liveTotals
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
            const user = await db.user.findUnique({
                where: { id: userId },
                select: { fullName: true, role: true, isActive: true }
            });
            if (!user?.isActive) {
                return { status: 'UNAUTHORIZED' as const };
            }
            const calculatedTotals = await cashCloseTotals(db, String(date), shiftType);
            if (totals != null && !sameCashTotals(totals, calculatedTotals)) {
                return { status: 'TOTALS_CHANGED' as const, liveTotals: calculatedTotals };
            }

            let cashClose = await db.cashClose.findFirst({
                where: {
                    date: dayRange,
                    shift: shiftType,
                    branchId: bId
                }
            });

            const signature = {
                // Preserve existing display labels; never accept the client's claimed role.
                role: user.role === 'SECRETARY' ? 'CAJERO' : user.role === 'PROFESSIONAL' ? 'MEDICO' : user.role,
                userId,
                name: user.fullName,
                timestamp: new Date().toISOString(),
                note: note || '',
                snapshot: {
                    total: calculatedTotals.total,
                    cash: calculatedTotals.cash,
                    card: calculatedTotals.card,
                    insurance: calculatedTotals.insurance
                }
            };

            if (!cashClose) {
                // Create new Close Snapshot
                cashClose = await db.cashClose.create({
                    data: {
                        date: queryDate,
                        branchId: bId,
                        shift: shiftType,
                        closedBy: userId,
                        totalAmount: calculatedTotals.total,
                        totalCash: calculatedTotals.cash,
                        totalCard: calculatedTotals.card,
                        totalInsurance: calculatedTotals.insurance,
                        signatures: [signature] as any
                    }
                });
            } else {
                // Append signature AND Update latest totals (Progressive Close)
                const currentSignatures = (cashClose.signatures as any[]) || [];
                const newSignatures = [...currentSignatures, signature];

                cashClose = await db.cashClose.update({
                    where: { id: cashClose.id },
                    data: {
                        signatures: newSignatures as any,
                        // Preserve progressive closing using the server-calculated snapshot
                        totalAmount: calculatedTotals.total,
                        totalCash: calculatedTotals.cash,
                        totalCard: calculatedTotals.card,
                        totalInsurance: calculatedTotals.insurance
                    }
                });
            }

            return { status: 'SIGNED' as const, cashClose };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

        if (result.status === 'UNAUTHORIZED') {
            return res.status(401).json({ error: 'La cuenta está inactiva o ya no existe' });
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
