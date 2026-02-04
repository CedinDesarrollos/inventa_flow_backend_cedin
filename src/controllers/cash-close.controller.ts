import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { startOfDay, endOfDay } from 'date-fns';

const TIMEZONE_OFFSET = 3; // UTC-3 (PYT)

// Helper to get ranges using explicit UTC strings to avoid server timezone issues
const getShiftRanges = (date: Date, shift: string) => {
    // Format date as YYYY-MM-DD
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    // Paraguay is UTC-3.
    // Daily Start (00:00 PYT) = 03:00 UTC
    // Shift Cutoff (14:00 PYT) = 17:00 UTC
    // Daily End (23:59 PYT) = 02:59 UTC (Next Day)

    const startUTC = new Date(`${dateStr}T03:00:00.000Z`);
    const cutoffUTC = new Date(`${dateStr}T17:00:00.000Z`);

    // End is 03:00 UTC on Next Day
    const endUTC = new Date(startUTC);
    endUTC.setDate(endUTC.getDate() + 1);
    endUTC.setUTCHours(2, 59, 59, 999); // Approx end of day tolerance

    if (shift === 'MORNING') {
        return { start: startUTC, end: cutoffUTC };
    }

    if (shift === 'AFTERNOON') {
        return { start: cutoffUTC, end: endUTC };
    }

    // ALL_DAY
    return { start: startUTC, end: endUTC };
};

export const getCashCloseStatus = async (req: Request, res: Response) => {
    try {
        const { date, branchId, shift = 'ALL_DAY' } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        const queryDate = new Date(String(date));
        const { start, end } = getShiftRanges(queryDate, String(shift));

        // For existing close, we search by the DATE field (stored as date object).
        // If we store it as 00:00 UTC, we should match closely?
        // Actually CashClose has `date` field.
        // It also has `shift` field string.
        // We just need to match the day and shift.
        // `queryDate` is likely 00:00 UTC. 
        // We should search for close record created for this DAY.
        // The Close record `date` usually stores the "Day" it represents.
        // Let's use flexible day match (UTC day).
        const dayStartUTC = startOfDay(queryDate);
        const dayEndUTC = endOfDay(queryDate);

        const bId = branchId ? String(branchId) : undefined;
        const shiftType = String(shift);

        console.log('Querying existing close...');
        const existingClose = await prisma.cashClose.findFirst({
            where: {
                date: {
                    gte: dayStartUTC,
                    lte: dayEndUTC
                },
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
                createdAt: {
                    gte: start,
                    lte: end
                }
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

        const queryDate = new Date(date);
        const dayStart = startOfDay(queryDate);
        const dayEnd = endOfDay(queryDate);
        const bId = branchId || null;
        const shiftType = String(shift);

        let cashClose = await prisma.cashClose.findFirst({
            where: {
                date: { gte: dayStart, lte: dayEnd },
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
        res.status(500).json({ error: 'Error signing cash close' });
    }
};
