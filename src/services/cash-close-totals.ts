import { Prisma } from '@prisma/client';
import { clinicShiftRange } from '../lib/clinic-dates';

export interface CashTotals {
    total: number;
    cash: number;
    card: number;
    insurance: number;
}

// Keep the existing receipt-based scope and payment-method classification.
// Status and signing must always use the same calculation.
export async function cashCloseTotals(db: Pick<Prisma.TransactionClient, 'payment'>, date: string, shift: string): Promise<CashTotals> {
    const groups = await db.payment.groupBy({
        by: ['paymentMethod'],
        where: { createdAt: clinicShiftRange(date, shift) },
        _sum: { amount: true }
    });
    const totals = { total: new Prisma.Decimal(0), cash: new Prisma.Decimal(0), card: new Prisma.Decimal(0), insurance: new Prisma.Decimal(0) };
    for (const group of groups) {
        const amount = group._sum.amount ?? new Prisma.Decimal(0);
        totals.total = totals.total.plus(amount);
        if (group.paymentMethod === 'CASH') totals.cash = totals.cash.plus(amount);
        else if (group.paymentMethod === 'CARD') totals.card = totals.card.plus(amount);
        else if (group.paymentMethod === 'INSURANCE') totals.insurance = totals.insurance.plus(amount);
    }
    return { total: totals.total.toNumber(), cash: totals.cash.toNumber(), card: totals.card.toNumber(), insurance: totals.insurance.toNumber() };
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
