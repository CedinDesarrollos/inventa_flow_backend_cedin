import { Prisma } from '@prisma/client';
import { clinicShiftRange } from '../lib/clinic-dates';

export interface CashTotals {
    total: number;
    cash: number;
    card: number;
    insurance: number;
}

export interface CashPaymentSnapshot {
    id: string;
    transactionId: string;
    amount: string;
    paymentMethod: string;
    createdAt: string;
}

export function sumCashPayments(payments: Pick<CashPaymentSnapshot, 'amount' | 'paymentMethod'>[]): CashTotals {
    const totals = { total: new Prisma.Decimal(0), cash: new Prisma.Decimal(0), card: new Prisma.Decimal(0), insurance: new Prisma.Decimal(0) };
    for (const payment of payments) {
        const amount = new Prisma.Decimal(payment.amount);
        totals.total = totals.total.plus(amount);
        if (payment.paymentMethod === 'CASH') totals.cash = totals.cash.plus(amount);
        else if (payment.paymentMethod === 'CARD') totals.card = totals.card.plus(amount);
        else if (payment.paymentMethod === 'INSURANCE') totals.insurance = totals.insurance.plus(amount);
    }
    return { total: totals.total.toNumber(), cash: totals.cash.toNumber(), card: totals.card.toNumber(), insurance: totals.insurance.toNumber() };
}

// A single read supplies both the amounts and the exact receipts being signed.
export async function cashCloseSnapshot(db: Pick<Prisma.TransactionClient, 'payment'>, date: string, shift: string) {
    const rows = await db.payment.findMany({
        where: { createdAt: clinicShiftRange(date, shift) },
        select: { id: true, transactionId: true, amount: true, paymentMethod: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const payments: CashPaymentSnapshot[] = rows.map(row => ({
        ...row, amount: row.amount.toString(), createdAt: row.createdAt.toISOString()
    }));
    return { totals: sumCashPayments(payments), payments };
}

export function validCashTotals(value: unknown): value is CashTotals {
    if (!value || typeof value !== 'object') return false;
    return ['total', 'cash', 'card', 'insurance'].every(key => {
        const amount = (value as Record<string, unknown>)[key];
        return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
    });
}

export function sameCashTotals(expected: CashTotals, actual: CashTotals) {
    return (['total', 'cash', 'card', 'insurance'] as const).every(key =>
        new Prisma.Decimal(expected[key]).toDecimalPlaces(2).equals(actual[key])
    );
}
