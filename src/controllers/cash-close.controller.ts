import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { startOfDay, endOfDay } from 'date-fns';

export const getCashCloseStatus = async (req: Request, res: Response) => {
    try {
        const { date, branchId } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        const queryDate = new Date(String(date));
        const start = startOfDay(queryDate);
        const end = endOfDay(queryDate);
        const bId = branchId ? String(branchId) : undefined;

        // 1. Check if a Close exists
        const existingClose = await prisma.cashClose.findFirst({
            where: {
                date: {
                    gte: start,
                    lte: end
                },
                ...(bId ? { branchId: bId } : {})
            },
            include: {
                closer: {
                    select: { fullName: true }
                }
            }
        });

        // 2. Calculate Live Totals (Always useful to compare)
        const transactions = await prisma.transaction.findMany({
            where: {
                createdAt: {
                    gte: start,
                    lte: end
                },
                status: 'COMPLETED',
                // Filter by branch if we had branch on transaction, currently inferred via Author or Patient?
                // Schema has transaction linked to Author/Patient.
                // Patient has branch.
                // For simplicity, we assume generic or linked via patient.
                // Note: Transaction doesn't strictly have branchId in schema provided.
                // We will rely on Patient's branch or User's (Author's) branch logic if needed.
                // For now, aggregate ALL if branchId not strictly filtered or implemented deeply.
            }
        });

        // If we strictly need branch filtering, we handle it in application logic or update schema.
        // Assuming single branch or global for now based on current schema constraints.

        const liveTotals = transactions.reduce((acc, t) => {
            acc.total += Number(t.total);
            if (t.paymentMethod === 'CASH') acc.cash += Number(t.total);
            else if (t.paymentMethod === 'CARD') acc.card += Number(t.total);
            else if (t.paymentMethod === 'INSURANCE') acc.insurance += Number(t.total);
            return acc;
        }, { total: 0, cash: 0, card: 0, insurance: 0 });

        res.json({
            close: existingClose,
            liveTotals
        });

    } catch (error) {
        console.error('Error getting cash close:', error);
        res.status(500).json({ error: 'Error getting cash close status' });
    }
};

export const signCashClose = async (req: Request, res: Response) => {
    try {
        // userId comes from auth middleware
        const userId = (req as any).user?.userId;
        const { date, branchId, note, role, totals } = req.body;

        if (!date || !role) {
            return res.status(400).json({ error: 'Date and Role are required' });
        }

        const queryDate = new Date(date);
        const start = startOfDay(queryDate);
        const end = endOfDay(queryDate);
        const bId = branchId || null;

        // Find existing or create
        let cashClose = await prisma.cashClose.findFirst({
            where: {
                date: { gte: start, lte: end },
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
