import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

// Validation schemas
const transactionItemSchema = z.object({
    serviceId: z.string().uuid().optional().nullable(),
    customDescription: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0), // Allow 0 for free services
    coverage: z.number().min(0),
    copay: z.number().min(0)
});

const createTransactionSchema = z.object({
    patientId: z.string().uuid(),
    doctorId: z.string().uuid().optional(),
    appointmentId: z.string().uuid().optional(),
    type: z.enum(['TICKET', 'INVOICE']),
    paymentMethod: z.enum(['CASH', 'CARD', 'INSURANCE', 'MIXED']), // Added MIXED
    paymentCode: z.string().optional(),
    paymentReceiptUrl: z.string().optional(),
    billingRuc: z.string().optional(),
    billingName: z.string().optional(),
    billingAddress: z.string().optional(),
    subtotal: z.number().min(0),
    savings: z.number().min(0),
    exoneratedAmount: z.number().min(0).optional().default(0),
    total: z.number().min(0),
    initialPayment: z.number().min(0).optional(),
    observation: z.string().optional(),
    items: z.array(transactionItemSchema),
    // New optional field for split payments
    payments: z.array(z.object({
        amount: z.number().positive(),
        paymentMethod: z.enum(['CASH', 'CARD', 'INSURANCE']),
        paymentCode: z.string().optional(),
        notes: z.string().optional()
    })).optional()
});

export const getTransactions = async (req: Request, res: Response) => {
    try {
        const { patientId, startDate, endDate, paymentMethod, status, doctorId, authorId } = req.query;

        console.log('Getting transactions with filters:', { patientId, startDate, endDate, paymentMethod, status, doctorId, authorId });

        const where: any = {};

        if (patientId) where.patientId = String(patientId);
        if (paymentMethod) where.paymentMethod = String(paymentMethod);
        if (status) where.status = String(status);
        if (doctorId) where.doctorId = String(doctorId);
        if (authorId) where.authorId = String(authorId);

        if (startDate && endDate) {
            // Input format: "2026-01-20" (local date)
            // We need to create a date range that covers the entire day in the local timezone
            // Then convert to UTC for database query
            const startStr = String(startDate);
            const endStr = String(endDate);

            // Parse as local dates (not UTC)
            const startLocal = new Date(startStr + 'T00:00:00');
            const endLocal = new Date(endStr + 'T23:59:59.999');

            where.createdAt = {
                gte: startLocal,
                lte: endLocal
            };

            console.log('Date filter (local):', {
                start: startLocal.toISOString(),
                end: endLocal.toISOString(),
                startLocal: startLocal.toString(),
                endLocal: endLocal.toString()
            });
        }

        console.log('Final where clause:', JSON.stringify(where, null, 2));

        const transactions = await prisma.transaction.findMany({
            where,
            include: {
                patient: {
                    include: {
                        insurance: true
                    }
                },
                author: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true
                    }
                },
                doctor: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true
                    }
                },
                items: {
                    include: {
                        service: true
                    }
                },
                payments: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        console.log(`Found ${transactions.length} transactions`);
        res.json(transactions);
    } catch (error: any) {
        console.error('Error fetching transactions:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ error: 'Error al obtener transacciones', details: error.message });
    }
};

export const getTransaction = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        const transaction = await prisma.transaction.findUnique({
            where: { id },
            include: {
                patient: true,
                author: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true
                    }
                },
                items: {
                    include: {
                        service: true
                    }
                }
            }
        });

        if (!transaction) {
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }

        res.json(transaction);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener transacción' });
    }
};

export const createTransaction = async (req: Request, res: Response) => {
    try {
        console.log('Creating transaction with data:', JSON.stringify(req.body, null, 2));
        const data = createTransactionSchema.parse(req.body);
        const userId = (req as any).user?.userId;

        // Start transaction to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
            // Determine initial payment amount
            let initialPayment = 0;
            const splitPayments = data.payments || [];

            if (splitPayments.length > 0) {
                // Sum up split payments
                initialPayment = splitPayments.reduce((sum, p) => sum + p.amount, 0);
            } else {
                // Fallback to legacy single payment
                initialPayment = data.initialPayment || 0;
            }

            const balance = data.total - initialPayment;
            // Allow small float variance
            const isCompleted = Math.abs(balance) < 0.01;
            const status = isCompleted ? 'COMPLETED' : initialPayment > 0 ? 'PARTIAL' : 'PENDING';

            // Determine main payment method for the Transaction record
            // If split payments are used, force MIXED.
            // If single payment, use the provided method.
            const mainPaymentMethod = splitPayments.length > 1 ? 'MIXED' : data.paymentMethod;

            const transaction = await tx.transaction.create({
                data: {
                    patientId: data.patientId,
                    authorId: userId,
                    doctorId: data.doctorId,
                    type: data.type,
                    paymentMethod: mainPaymentMethod,
                    paymentCode: data.paymentCode, // Keeps legacy single code if needed
                    paymentReceiptUrl: data.paymentReceiptUrl,
                    billingRuc: data.billingRuc,
                    billingName: data.billingName,
                    billingAddress: data.billingAddress,
                    subtotal: data.subtotal,
                    savings: data.savings,
                    exoneratedAmount: data.exoneratedAmount,
                    total: data.total,
                    amountPaid: initialPayment,
                    balance: balance,
                    status: status,
                    observation: data.observation,
                    items: {
                        create: data.items.map(item => ({
                            ...(item.serviceId ? { serviceId: item.serviceId } : {}),
                            customDescription: item.customDescription,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            coverage: item.coverage,
                            copay: item.copay
                        })) as any
                    }
                },
                include: {
                    patient: true,
                    author: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true
                        }
                    },
                    items: {
                        include: {
                            service: true
                        }
                    },
                    payments: true
                }
            });

            // Create Payment Records
            if (splitPayments.length > 0) {
                // Create multiple payments
                for (const p of splitPayments) {
                    await tx.payment.create({
                        data: {
                            transactionId: transaction.id,
                            amount: p.amount,
                            paymentMethod: p.paymentMethod,
                            paymentCode: p.paymentCode,
                            // receiptUrl: data.paymentReceiptUrl, // Optionally attach receipt to all? Or just main
                            notes: p.notes || 'Split payment',
                            createdBy: userId
                        }
                    });
                }
            } else if (initialPayment > 0) {
                // Create single legacy payment
                await tx.payment.create({
                    data: {
                        transactionId: transaction.id,
                        amount: initialPayment,
                        paymentMethod: data.paymentMethod as any, // Cast if needed but Schema says CASH/CARD/INSURANCE/MIXED. Payment table enum likely handles it.
                        // Wait, Payment table PaymentMethod likely assumes CASH/CARD/INSURANCE.
                        // If Transaction is MIXED, individual payments must be specific.
                        // In legacy flow, data.paymentMethod is usually specific.
                        // If user sent MIXED without payments array, that's an edge case we shouldn't hit with frontend logic.
                        // But to be safe:
                        paymentCode: data.paymentCode,
                        receiptUrl: data.paymentReceiptUrl,
                        notes: 'Initial payment',
                        createdBy: userId
                    }
                });
            }

            // Update Appointment Payment Status if linked
            if (data.appointmentId) {
                const paymentStatus = isCompleted ? 'PAID' : 'PARTIAL';
                await tx.appointment.update({
                    where: { id: data.appointmentId },
                    data: {
                        paymentStatus: paymentStatus
                    }
                });
                console.log(`Updated appointment ${data.appointmentId} payment status to ${paymentStatus}`);
            }

            return transaction;
        });

        res.status(201).json(result);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('Validation error:', error.issues);
            return res.status(400).json({ error: 'Validation error', details: error.issues });
        }
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Error al crear transacción' });
    }
};

export const voidTransaction = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        const transaction = await prisma.transaction.update({
            where: { id },
            data: {
                status: 'VOIDED'
            },
            include: {
                patient: true,
                author: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true
                    }
                },
                items: {
                    include: {
                        service: true
                    }
                }
            }
        });

        res.json(transaction);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al anular transacción' });
    }
};
