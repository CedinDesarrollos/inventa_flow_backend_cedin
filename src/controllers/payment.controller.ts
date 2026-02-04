import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const paymentSchema = z.object({
    amount: z.number().positive(),
    paymentMethod: z.enum(['CASH', 'CARD', 'INSURANCE']),
    paymentCode: z.string().optional(),
    notes: z.string().optional()
});

/**
 * Create a new payment for a transaction
 * POST /api/transactions/:id/payments
 */
export const createPayment = async (req: Request, res: Response) => {
    try {
        const { id: transactionId } = req.params;
        const userId = (req as any).user?.userId;

        const data = paymentSchema.parse(req.body);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get transaction
            const transaction = await tx.transaction.findUnique({
                where: { id: String(transactionId) }
            });

            if (!transaction) {
                throw new Error('Transaction not found');
            }

            if (transaction.status === 'COMPLETED') {
                throw new Error('Transaction is already fully paid');
            }

            if (transaction.status === 'VOIDED') {
                throw new Error('Cannot add payment to voided transaction');
            }

            const currentBalance = Number(transaction.balance);

            if (data.amount > currentBalance) {
                throw new Error(`Payment amount (${data.amount}) exceeds balance (${currentBalance})`);
            }

            // 2. Create Payment
            const payment = await tx.payment.create({
                data: {
                    transactionId: String(transactionId),
                    amount: data.amount,
                    paymentMethod: data.paymentMethod,
                    paymentCode: data.paymentCode,
                    notes: data.notes,
                    createdBy: userId
                },
                include: {
                    user: {
                        select: { fullName: true }
                    }
                }
            });

            // 3. Update Transaction
            const newAmountPaid = Number(transaction.amountPaid) + data.amount;
            const newBalance = Number(transaction.total) - newAmountPaid;
            const newStatus = newBalance === 0 ? 'COMPLETED' : 'PARTIAL';

            const updatedTransaction = await tx.transaction.update({
                where: { id: String(transactionId) },
                data: {
                    amountPaid: newAmountPaid,
                    balance: newBalance,
                    status: newStatus
                },
                include: {
                    payments: {
                        include: {
                            user: { select: { fullName: true } }
                        },
                        orderBy: { createdAt: 'desc' }
                    },
                    patient: true
                }
            });

            return { payment, transaction: updatedTransaction };
        });

        res.json(result);

    } catch (error: any) {
        console.error('Create Payment Error:', error);

        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Invalid payment data', errors: error.issues });
        }

        if (error.message.includes('not found') || error.message.includes('exceeds balance') || error.message.includes('already fully paid') || error.message.includes('voided')) {
            return res.status(400).json({ message: error.message });
        }

        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get all payments for a transaction
 * GET /api/transactions/:id/payments
 */
export const getPayments = async (req: Request, res: Response) => {
    try {
        const { id: transactionId } = req.params;

        const payments = await prisma.payment.findMany({
            where: { transactionId: String(transactionId) },
            include: {
                user: {
                    select: { fullName: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(payments);

    } catch (error) {
        console.error('Get Payments Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get accounts receivable report (transactions with pending balance)
 * GET /api/reports/accounts-receivable
 */
export const getAccountsReceivable = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, minBalance } = req.query;

        const where: any = {
            status: { in: ['PENDING', 'PARTIAL'] },
            balance: { gt: minBalance ? Number(minBalance) : 0 }
        };

        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(String(startDate)),
                lte: new Date(String(endDate))
            };
        }

        const pendingTransactions = await prisma.transaction.findMany({
            where,
            include: {
                patient: {
                    select: {
                        firstName: true,
                        lastName: true,
                        phone: true,
                        identifier: true
                    }
                },
                payments: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        createdAt: true,
                        amount: true
                    }
                },
                items: {
                    include: {
                        service: {
                            select: { name: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        // Group by patient
        const debtorsMap = new Map();

        pendingTransactions.forEach((t: any) => {
            if (!debtorsMap.has(t.patientId)) {
                debtorsMap.set(t.patientId, {
                    patientId: t.patientId,
                    patientName: `${t.patient.firstName} ${t.patient.lastName}`,
                    patientRut: t.patient.identifier || '',
                    totalDebt: 0,
                    transactionCount: 0,
                    transactions: []
                });
            }

            const debtor = debtorsMap.get(t.patientId);
            debtor.totalDebt += Number(t.balance);
            debtor.transactionCount += 1;

            debtor.transactions.push({
                id: t.id,
                createdAt: t.createdAt,
                total: Number(t.total),
                amountPaid: Number(t.amountPaid),
                balance: Number(t.balance),
                status: t.status,
                patient: {
                    id: t.patientId,
                    firstName: t.patient.firstName,
                    lastName: t.patient.lastName,
                    rut: t.patient.identifier || ''
                },
                items: t.items.map((i: any) => ({
                    customDescription: i.customDescription,
                    service: i.service ? { name: i.service.name } : undefined
                }))
            });
        });

        const debtors = Array.from(debtorsMap.values());
        const totalDebt = debtors.reduce((sum: number, d: any) => sum + d.totalDebt, 0);
        const totalTransactions = pendingTransactions.length;

        res.json({
            totalDebt,
            totalTransactions,
            debtors
        });

    } catch (error) {
        console.error('Get Accounts Receivable Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
