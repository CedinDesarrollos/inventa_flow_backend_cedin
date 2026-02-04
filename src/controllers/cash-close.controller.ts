import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { startOfDay, endOfDay } from 'date-fns';

export const getCashCloseStatus = async (req: Request, res: Response) => {
    try {
        const { date, branchId, shift = 'ALL_DAY' } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        const queryDate = new Date(String(date));
        // Base ranges for the day
        let start = startOfDay(queryDate);
        const dayEnd = endOfDay(queryDate);
        let end = dayEnd;

        // Apply Shift Logic
        const shiftType = String(shift);
        if (shiftType === 'MORNING') {
            // 00:00 to 13:00
            end = new Date(start);
            end.setHours(13, 0, 0, 0);
        } else if (shiftType === 'AFTERNOON') {
            // 13:00 to 23:59:59
            const newStart = new Date(start);
            newStart.setHours(13, 0, 0, 0);
            start = newStart;
        }

        const bId = branchId ? String(branchId) : undefined;

        console.log('Querying existing close...');
        // 1. Check if a Close exists for this shift
        const existingClose = await prisma.cashClose.findFirst({
            where: {
                date: {
                    gte: startOfDay(queryDate), // Ensure we match the "day"
                    lte: dayEnd
                },
                shift: shiftType, // Match specific shift
                ...(bId ? { branchId: bId } : {})
            },
            include: {
                closer: {
                    select: { fullName: true }
                }
            }
        });
        console.log('Existing close:', existingClose);

        // 2. Calculate Live Totals from Payments (not Transactions)
        // This ensures we count actual money received, not just invoiced amounts
        console.log('Querying payments...');
        const payments = await prisma.payment.findMany({
            where: {
                createdAt: {
                    gte: start,
                    lte: end
                }
            }
        });
        console.log(`Found ${payments.length} payments`);

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
        // userId comes from auth middleware
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

        // Find existing or create for this specific shift
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
