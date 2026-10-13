import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { clinicDateRange } from '../lib/clinic-dates';
import { BillingError, lockBillingAppointment, lockBillingTransaction, syncAppointmentPayments } from '../services/transactions/appointment-payments';

// Match PostgreSQL Decimal(10, 2) storage when calculating persisted balances.
const storedMoney = (value: number) => new Prisma.Decimal(value).toDecimalPlaces(2);

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
}).superRefine((data, context) => {
    const splitPayments = data.payments || [];
    const amounts = splitPayments.length ? splitPayments.map(payment => payment.amount) : [data.initialPayment || 0];
    const paid = amounts.reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0));
    const storedPaid = amounts.reduce((sum, amount) => sum.plus(storedMoney(amount)), new Prisma.Decimal(0));
    if (paid.gt(data.total) || storedPaid.gt(storedMoney(data.total))) {
        context.addIssue({ code: 'custom', path: [splitPayments.length ? 'payments' : 'initialPayment'], message: 'El pago inicial no puede superar el total.' });
    }
    splitPayments.forEach((payment, index) => {
        if (storedMoney(payment.amount).isZero()) {
            context.addIssue({ code: 'custom', path: ['payments', index, 'amount'], message: 'El pago debe ser al menos 0.01.' });
        }
    });
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

        if (Boolean(startDate) !== Boolean(endDate)) throw new RangeError('Se requieren ambas fechas');
        const dateRange = startDate && endDate ? clinicDateRange(String(startDate), String(endDate)) : undefined;
        const cashFlow = req.query.cashFlow === 'true';
        if (cashFlow && !dateRange) throw new RangeError('El cierre requiere un rango de fechas');
        if (dateRange) {
            if (cashFlow) {
                delete where.authorId;
                where.OR = [
                    { payments: { some: { createdAt: dateRange, ...(authorId ? { createdBy: String(authorId) } : {}) } } },
                    { createdAt: dateRange, payments: { none: {} }, ...(authorId ? { authorId: String(authorId) } : {}) }
                ];
            } else where.createdAt = dateRange;
        }

        console.log('Final where clause:', JSON.stringify(where, null, 2));

        const storedTransactions = await prisma.transaction.findMany({
            where,
            include: {
                appointment: { select: { branchId: true } },
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
                payments: { ...(cashFlow ? { where: { createdAt: dateRange, ...(authorId ? { createdBy: String(authorId) } : {}) } } : {}), include: { user: { select: { id: true, fullName: true, email: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const transactions = storedTransactions.map(transaction => ({...transaction, branchId: transaction.appointment?.branchId || transaction.patient?.branchId || null}));
        console.log(`Found ${transactions.length} transactions`);
        if (cashFlow) {
            res.json(transactions.flatMap(transaction => {
                if (transaction.payments.length) return transaction.payments.map((payment, index) => ({
                    ...transaction, reportRowId: `${transaction.id}:${payment.id}`, transactionCreatedAt: transaction.createdAt,
                    createdAt: payment.createdAt, amountPaid: payment.amount, paymentMethod: payment.paymentMethod,
                    author: payment.user || transaction.author, payments: [payment],
                    savings: index === 0 && dateRange && transaction.createdAt >= dateRange.gte && transaction.createdAt < dateRange.lt ? transaction.savings : new Prisma.Decimal(0),
                    exoneratedAmount: index === 0 && dateRange && transaction.createdAt >= dateRange.gte && transaction.createdAt < dateRange.lt ? transaction.exoneratedAmount : new Prisma.Decimal(0)
                }));
                return [transaction]; // Legacy transactions without receipt records.
            }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
        } else res.json(transactions);
    } catch (error: any) {
        if (error instanceof RangeError) return res.status(400).json({ error: error.message });
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
            let billingDoctorId = data.doctorId;
            if (data.appointmentId) {
                const appointment = await lockBillingAppointment(tx, data.appointmentId);
                if (appointment.patientId !== data.patientId || (data.doctorId && appointment.doctorId !== data.doctorId)) {
                    throw new BillingError(400, 'La cita no corresponde al paciente o profesional del cobro');
                }
                billingDoctorId = data.doctorId || appointment.doctorId || undefined;
            }
            // Determine initial payment amount
            let initialPayment = storedMoney(data.initialPayment || 0);
            const splitPayments = (data.payments || []).map(payment => ({ ...payment, amount: storedMoney(payment.amount) }));

            if (splitPayments.length > 0) {
                // Sum up split payments
                initialPayment = splitPayments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
            }

            const balance = storedMoney(data.total).minus(initialPayment);
            const isCompleted = balance.isZero();
            const status = isCompleted ? 'COMPLETED' : initialPayment.gt(0) ? 'PARTIAL' : 'PENDING';

            // Determine main payment method for the Transaction record
            // If split payments are used, force MIXED.
            // If single payment, use the provided method.
            const mainPaymentMethod = splitPayments.length > 1 ? 'MIXED' : data.paymentMethod;

            const transaction = await tx.transaction.create({
                data: {
                    patientId: data.patientId,
                    appointmentId: data.appointmentId,
                    authorId: userId,
                    doctorId: billingDoctorId,
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
            } else if (initialPayment.gt(0)) {
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

            if (data.appointmentId) await syncAppointmentPayments(tx, data.appointmentId);

            return transaction;
        });

        res.status(201).json(result);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('Validation error:', error.issues);
            return res.status(400).json({ error: 'Validation error', details: error.issues });
        }
        if (error instanceof BillingError) return res.status(error.status).json({ error: error.message });
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Error al crear transacción' });
    }
};

export const voidTransaction = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        const transaction = await prisma.$transaction(async tx => {
            const current = await lockBillingTransaction(tx, id);
            const voided = await tx.transaction.update({
                where: { id },
                data: { status: 'VOIDED' },
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

            if (current.appointmentId) await syncAppointmentPayments(tx, current.appointmentId);
            return voided;
        });
        res.json(transaction);
    } catch (error) {
        if (error instanceof BillingError) return res.status(error.status).json({ error: error.message });
        console.error(error);
        res.status(500).json({ error: 'Error al anular transacción' });
    }
};

// Reconcile an explicitly identified historical account; never infer a link from patient/date.
export const linkTransactionAppointment = async (req: Request, res: Response) => {
    try {
        const { appointmentId } = z.object({ appointmentId: z.string().uuid() }).parse(req.body);
        const id = String(req.params.id);
        const result = await prisma.$transaction(async tx => {
            const appointment = await lockBillingAppointment(tx, appointmentId);
            await tx.$queryRaw`SELECT id FROM inventa_clinical_app.transactions WHERE id = ${id} FOR UPDATE`;
            const current = await tx.transaction.findUnique({ where: { id } });
            if (!current) throw new BillingError(404, 'Transacción no encontrada');
            if (current.appointmentId && current.appointmentId !== appointmentId) throw new BillingError(409, 'La transacción ya está vinculada a otra cita');
            if (current.patientId !== appointment.patientId || (current.doctorId && current.doctorId !== appointment.doctorId)) throw new BillingError(400, 'La cita no corresponde al paciente o profesional del cobro');
            const updated = await tx.transaction.update({ where: { id }, data: { appointmentId } });
            await syncAppointmentPayments(tx, appointmentId);
            return updated;
        });
        res.json(result);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Cita inválida' });
        if (error instanceof BillingError) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Error al vincular la transacción' });
    }
};
