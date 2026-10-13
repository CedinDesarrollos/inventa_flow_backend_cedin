import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { cashCloseDateRange, clinicShiftRange } from '../lib/clinic-dates';

export const getCashCloseStatus = async (req: Request, res: Response) => {
    try {
        const { date, branchId, shift = 'ALL_DAY' } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        const paymentRange = clinicShiftRange(String(date), String(shift));

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

        // 2. Calculate Live Totals from Payments
        // Using adjusted timezone ranges
        const payments = await prisma.payment.findMany({
            where: {
                createdAt: paymentRange
            }
        });

        const liveTotals = payments.reduce((acc: { total: number; cash: number; card: number; insurance: number }, p) => {
            const amount = Number(p.amount);
            acc.total += amount;
            if (p.paymentMethod === 'CASH') acc.cash += amount;
            else if (p.paymentMethod === 'CARD') acc.card += amount;
            else if (p.paymentMethod === 'INSURANCE') acc.insurance += amount;
            return acc;
        }, { total: 0, cash: 0, card: 0, insurance: 0 });


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

export const signCashClose = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { date, branchId, note, role, totals, shift = 'ALL_DAY' } = req.body;

        if (!date || !role) {
            return res.status(400).json({ error: 'Date and Role are required' });
        }

        const dayRange = cashCloseDateRange(String(date));
        clinicShiftRange(String(date), String(shift));
        const queryDate = dayRange.gte;
        const bId = branchId || null;
        const shiftType = String(shift);

        let cashClose = await prisma.cashClose.findFirst({
            where: {
                date: dayRange,
                shift: shiftType,
                branchId: bId
            }
        });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        const signature = {
            role,
            userId,
            name: user?.fullName || 'Usuario',
            timestamp: new Date().toISOString(),
            note: note || '',
            snapshot: {
                total: totals?.total || 0,
                cash: totals?.cash || 0,
                card: totals?.card || 0,
                insurance: totals?.insurance || 0
            }
        };

        if (!cashClose) {
            // Create new Close Snapshot
            cashClose = await prisma.cashClose.create({
                data: {
                    date: queryDate,
                    branchId: bId,
                    shift: shiftType,
                    closedBy: userId,
                    totalAmount: totals?.total || 0,
                    totalCash: totals?.cash || 0,
                    totalCard: totals?.card || 0,
                    totalInsurance: totals?.insurance || 0,
                    signatures: [signature] as any
                }
            });
        } else {
            // Append signature AND Update latest totals (Progressive Close)
            const currentSignatures = (cashClose.signatures as any[]) || [];
            const newSignatures = [...currentSignatures, signature];

            cashClose = await prisma.cashClose.update({
                where: { id: cashClose.id },
                data: {
                    signatures: newSignatures as any,
                    // Always update totals to the latest snapshot provided by the signer
                    totalAmount: totals?.total || 0,
                    totalCash: totals?.cash || 0,
                    totalCard: totals?.card || 0,
                    totalInsurance: totals?.insurance || 0
                }
            });
        }

        res.json(cashClose);

    } catch (error) {
        console.error('Error signing cash close:', error);
        if (error instanceof RangeError) return res.status(400).json({ error: error.message });
        res.status(500).json({ error: 'Error signing cash close' });
    }
};
