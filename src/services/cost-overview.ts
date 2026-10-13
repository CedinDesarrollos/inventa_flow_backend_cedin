import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { CLINIC_TIMEZONE } from '../lib/clinic-dates';

export type ExpenseOrigin = 'individual' | 'recurring' | 'inventory';
export interface OverviewCost {
    id: string; categoryId: string; description: string; amount: Prisma.Decimal | number | string;
    date: Date; isRecurring: boolean; recurringParentId?: string | null; recurringPeriod?: string | null;
    branchId?: string | null; receiptUrl?: string | null;
    category: { name: string }; branch?: { name: string } | null;
    parent?: { description: string } | null; inventoryMovements?: { id: string }[];
}

// Legacy forms stored calendar dates at UTC midnight; preserve those calendar labels.
export function expensePaymentDay(date: Date) {
    const utc = DateTime.fromJSDate(date, { zone: 'UTC' });
    return (utc.hour === 0 && utc.minute === 0 && utc.second === 0 && utc.millisecond === 0
        ? utc : utc.setZone(CLINIC_TIMEZONE)).toISODate()!;
}

export interface OverviewFilters {
    startMonth: string; endMonth: string; basis: 'payment' | 'period'; origin?: ExpenseOrigin;
    categoryId?: string; conceptId?: string; search?: string; month?: string; detailOrigin?: ExpenseOrigin;
    page: number; pageSize: number;
}

export function expenseOverview(costs: OverviewCost[], filters: OverviewFilters) {
    const start = DateTime.fromISO(filters.startMonth + '-01', { zone: 'UTC' });
    const end = DateTime.fromISO(filters.endMonth + '-01', { zone: 'UTC' });
    const monthCount = Math.round(end.diff(start, 'months').months) + 1;
    if (!start.isValid || !end.isValid || monthCount < 1 || monthCount > 60) throw new RangeError('Seleccione un rango de hasta 60 meses');
    const allRows = costs.filter(cost => !cost.isRecurring).map(cost => {
        const origin: ExpenseOrigin = cost.recurringParentId || cost.recurringPeriod ? 'recurring' : cost.inventoryMovements?.length ? 'inventory' : 'individual';
        const paymentDay = expensePaymentDay(cost.date);
        // Legacy recurring payments keep the original UTC-month assignment used by recurring status.
        const period = cost.recurringPeriod || (cost.recurringParentId ? cost.date.toISOString().slice(0, 7) : paymentDay.slice(0, 7));
        const conceptName = cost.parent?.description || cost.description;
        const key = cost.recurringParentId ? `recurring:${cost.recurringParentId}` : `${origin}:${cost.categoryId}:${conceptName.trim().toLocaleLowerCase('es')}`;
        const conceptId = createHash('sha256').update(key).digest('hex');
        return {
            id: cost.id, categoryId: cost.categoryId, category: cost.category, description: cost.description,
            amount: Number(cost.amount), date: cost.date.toISOString(), paymentDay, period, origin, conceptId, conceptName,
            recurringParentId: cost.recurringParentId, recurringPeriod: cost.recurringPeriod,
            branch: cost.branch, branchId: cost.branchId, receiptUrl: cost.receiptUrl,
            reportMonth: filters.basis === 'period' ? period : paymentDay.slice(0, 7)
        };
    });
    const rows = allRows.filter(row => row.reportMonth >= filters.startMonth && row.reportMonth <= filters.endMonth);
    const categories = [...new Map(allRows.map(row => [row.categoryId, { id: row.categoryId, name: row.category.name }])).values()].sort((a,b) => a.name.localeCompare(b.name));
    const conceptOptions = new Map<string, { id: string; name: string; categories: Set<string>; origin: ExpenseOrigin }>();
    for (const row of allRows.filter(row => (!filters.categoryId || row.categoryId === filters.categoryId) && (!filters.origin || row.origin === filters.origin))) {
        const option = conceptOptions.get(row.conceptId) || { id: row.conceptId, name: row.conceptName, categories: new Set<string>(), origin: row.origin };
        option.categories.add(row.category.name); conceptOptions.set(row.conceptId, option);
    }
    const concepts = [...conceptOptions.values()].map(item => ({ id: item.id, name: item.name, category: [...item.categories].join(' / '), origin: item.origin })).sort((a,b) => a.name.localeCompare(b.name));
    const search = filters.search?.trim().toLocaleLowerCase('es');
    const base = rows.filter(row => (!filters.categoryId || row.categoryId === filters.categoryId)
        && (!filters.origin || row.origin === filters.origin) && (!filters.conceptId || row.conceptId === filters.conceptId)
        && (!search || `${row.description} ${row.category.name} ${row.conceptName}`.toLocaleLowerCase('es').includes(search)));
    const buckets = Array.from({ length: monthCount }, (_, index) => ({ month: start.plus({ months: index }).toFormat('yyyy-MM'), individual: 0, recurring: 0, inventory: 0, total: 0 }));
    const conceptTotals = new Map<string, { id: string; name: string; categoryNames: Set<string>; origin: ExpenseOrigin; amount: number; count: number }>();
    const distribution = new Map<string, { id: string; name: string; amount: number; count: number }>();
    for (const row of base) {
        const cents = Math.round(row.amount * 100);
        const bucket = buckets.find(item => item.month === row.reportMonth)!;
        bucket[row.origin] += cents; bucket.total += cents;
        const category = distribution.get(row.categoryId) || { id: row.categoryId, name: row.category.name, amount: 0, count: 0 };
        category.amount += cents; category.count++; distribution.set(row.categoryId, category);
        const concept = conceptTotals.get(row.conceptId) || { id: row.conceptId, name: row.conceptName, categoryNames: new Set<string>(), origin: row.origin, amount: 0, count: 0 };
        concept.amount += cents; concept.count++; concept.categoryNames.add(row.category.name); conceptTotals.set(row.conceptId, concept);
    }
    const comparison = buckets.map(bucket => ({ ...bucket, individual: bucket.individual / 100, recurring: bucket.recurring / 100, inventory: bucket.inventory / 100, total: bucket.total / 100 }));
    const detail = base.filter(row => (!filters.month || row.reportMonth === filters.month) && (!filters.detailOrigin || row.origin === filters.detailOrigin));
    detail.sort((a,b) => b.paymentDay.localeCompare(a.paymentDay) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const totalPages = Math.max(1, Math.ceil(detail.length / filters.pageSize));
    const page = Math.min(filters.page, totalPages);
    const total = (items: typeof base) => items.reduce((sum,row) => sum + Math.round(row.amount * 100), 0) / 100;
    const last = comparison[comparison.length - 1]?.total || 0, previous = comparison[comparison.length - 2]?.total || 0;
    return {
        comparison, categories: [...distribution.values()].map(item => ({ ...item, amount: item.amount / 100 })).sort((a,b) => b.amount - a.amount),
        concepts: [...conceptTotals.values()].map(item => ({ id: item.id, name: item.name, category: [...item.categoryNames].join(' / '), origin: item.origin, amount: item.amount / 100, count: item.count })).sort((a,b) => b.amount - a.amount),
        summary: { total: total(base), count: base.length, unassignedCount: base.filter(row => !row.branchId).length, unassignedTotal: total(base.filter(row => !row.branchId)), lastMonth: last, previousMonth: previous, changePercent: previous ? (last - previous) / previous * 100 : null },
        payments: detail.slice((page - 1) * filters.pageSize, page * filters.pageSize),
        pagination: { page, pageSize: filters.pageSize, total: detail.length, totalPages },
        detailTotal: total(detail), options: { categories, concepts }
    };
}
