import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware';
import { expenseOverview, expensePaymentDay } from '../services/cost-overview';

// ========== VALIDATION SCHEMAS ==========

const costCategorySchema = z.object({
    name: z.string().min(1),
    type: z.enum(['FIXED', 'VARIABLE', 'EVENT']),
    description: z.string().optional()
});

const costSchema = z.object({
    categoryId: z.string().uuid(),
    description: z.string().min(1),
    amount: z.number().positive(),
    date: z.string().datetime(),
    isRecurring: z.boolean().optional().default(false),
    recurrenceRule: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
    branchId: z.string().uuid().nullable().optional(),
    receiptUrl: z.string().url().optional().or(z.literal('')),
    notes: z.string().optional(),
    items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional()
    })).optional()
});

// ========== CATEGORIES ==========

export const getCategories = async (req: Request, res: Response) => {
    try {
        const categories = await prisma.costCategory.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' }
        });
        res.json(categories);
    } catch (error) {
        console.error('Get Categories Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createCategory = async (req: Request, res: Response) => {
    try {
        const data = costCategorySchema.parse(req.body);
        const category = await prisma.costCategory.create({ data });
        res.status(201).json(category);
    } catch (error) {
        console.error('Create Category Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.issues });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const data = costCategorySchema.partial().parse(req.body);
        const category = await prisma.costCategory.update({
            where: { id: id as string },
            data
        });
        res.json(category);
    } catch (error) {
        console.error('Update Category Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.issues });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.costCategory.update({
            where: { id: id as string },
            data: { isActive: false }
        });
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Delete Category Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ========== COSTS ==========

export const getCosts = async (req: Request, res: Response) => {
    try {
        const query = z.object({
            startDate: z.string().optional(), endDate: z.string().optional(),
            categoryId: z.string().uuid().optional(), branchId: z.string().uuid().optional(),
            isRecurring: z.enum(['true', 'false']).default('false')
        }).parse(req.query);
        const costs = await prisma.cost.findMany({
            where: { isRecurring: query.isRecurring === 'true', ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.branchId ? { branchId: query.branchId } : {}) },
            include: { category: true, branch: true }, orderBy: { date: 'desc' }
        });
        const dayLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) || /T00:00:00(?:\.000)?Z$/.test(value);
        for (const value of [query.startDate, query.endDate]) if (value && !Number.isFinite(new Date(value).getTime())) return res.status(400).json({ message: 'Fecha inválida' });
        const filtered = costs.filter(cost => {
            const day = expensePaymentDay(cost.date);
            const afterStart = !query.startDate || (dayLabel(query.startDate) ? day >= query.startDate.slice(0,10) : cost.date >= new Date(query.startDate));
            const beforeEnd = !query.endDate || (dayLabel(query.endDate) ? day <= query.endDate.slice(0,10) : cost.date <= new Date(query.endDate));
            return afterStart && beforeEnd;
        });
        res.json(filtered);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ message: 'Filtros inválidos' });
        console.error('Get Costs Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getExpenseOverview = async (req: Request, res: Response) => {
    try {
        const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(value => Number(value.slice(0,4)) >= 1900);
        const origin = z.enum(['individual', 'recurring', 'inventory']);
        const filters = z.object({
            startMonth: month, endMonth: month, basis: z.enum(['payment', 'period']).default('period'),
            categoryId: z.string().uuid().optional(), conceptId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
            branchId: z.string().uuid().optional(), includeUnassigned: z.enum(['true', 'false']).default('true'), origin: origin.optional(), search: z.string().max(200).optional(),
            month: month.optional(), detailOrigin: origin.optional(),
            page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25)
        }).parse(req.query);
        const costs = await prisma.cost.findMany({
            where: { isRecurring: false, ...(filters.branchId ? (filters.includeUnassigned === 'true' ? { OR: [{ branchId: filters.branchId }, { branchId: null }] } : { branchId: filters.branchId }) : {}) },
            include: { category: true, branch: { select: { name: true } }, parent: { select: { description: true } }, inventoryMovements: { select: { id: true } } }
        });
        res.json(expenseOverview(costs, filters));
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof RangeError) return res.status(400).json({ message: error instanceof RangeError ? error.message : 'Filtros de comparativo inválidos' });
        console.error('Expense overview failed:', error);
        res.status(500).json({ message: 'No se pudo cargar el comparativo de gastos' });
    }
};

export const createCost = async (req: Request, res: Response) => {
    try {
        const data = costSchema.parse(req.body);
        const userId = (req as AuthRequest).user?.userId;
        const { items, ...costData } = data;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Cost
            const cost = await tx.cost.create({
                data: {
                    ...costData,
                    createdBy: userId
                },
                include: {
                    category: true,
                    branch: true
                }
            });

            // 2. If it has inventory items, process them
            if (items && items.length > 0) {
                for (const item of items) {
                    // Create Movement
                    await tx.inventoryMovement.create({
                        data: {
                            productId: item.productId,
                            costId: cost.id,
                            type: 'IN',
                            quantity: item.quantity,
                            notes: `Compra vinculada a costo`,
                            createdBy: userId
                        }
                    });

                    // Update Stock
                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            currentStock: { increment: item.quantity },
                            costPrice: item.unitPrice ? item.unitPrice : undefined // Update last cost price?
                        }
                    });
                }
            }

            return cost;
        });

        res.status(201).json(result);
    } catch (error) {
        console.error('Create Cost Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.issues });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateCost = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const data = costSchema.partial().parse(req.body);

        const cost = await prisma.cost.update({
            where: { id: id as string },
            data,
            include: {
                category: true,
                branch: true
            }
        });

        res.json(cost);
    } catch (error) {
        console.error('Update Cost Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.issues });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteCost = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.cost.delete({
            where: { id: id as string }
        });

        res.json({ message: 'Cost deleted successfully' });
    } catch (error) {
        console.error('Delete Cost Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ========== REPORTS ==========

export const getCostSummary = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, branchId } = req.query;

        const where: any = { isRecurring: false };

        if (startDate && endDate) {
            where.date = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string)
            };
        }

        if (branchId) {
            where.branchId = branchId as string;
        }

        // Get all costs in period
        const costs = await prisma.cost.findMany({
            where,
            include: {
                category: true
            }
        });

        // Calculate total
        const totalAmount = costs.reduce((sum, cost) => sum + Number(cost.amount), 0);

        // Group by category
        const byCategory: Record<string, { categoryId: string; categoryName: string; total: number }> = {};

        costs.forEach(cost => {
            const catId = cost.categoryId;
            if (!byCategory[catId]) {
                byCategory[catId] = {
                    categoryId: catId,
                    categoryName: cost.category.name,
                    total: 0
                };
            }
            byCategory[catId].total += Number(cost.amount);
        });

        // Convert to array and add percentages
        const byCategoryArray = Object.values(byCategory).map(cat => ({
            ...cat,
            percentage: totalAmount > 0 ? (cat.total / totalAmount) * 100 : 0
        }));

        res.json({
            totalAmount,
            byCategory: byCategoryArray,
            period: {
                start: startDate || null,
                end: endDate || null
            }
        });
    } catch (error) {
        console.error('Get Cost Summary Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getRecurringPreview = async (req: Request, res: Response) => {
    try {
        const recurringCosts = await prisma.cost.findMany({
            where: { isRecurring: true },
            include: {
                category: true,
                branch: true
            },
            orderBy: { description: 'asc' }
        });

        res.json(recurringCosts);
    } catch (error) {
        console.error('Get Recurring Preview Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getFinancialReport = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const end = endDate ? new Date(endDate as string) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

        // 1. Get Income (Completed Transactions)
        const incomeTransactions = await prisma.transaction.findMany({
            where: {
                status: 'COMPLETED',
                updatedAt: {
                    gte: start,
                    lte: end
                }
            }
        });

        const totalIncome = incomeTransactions.reduce((sum, t) => sum + Number(t.total), 0);

        // 2. Get Expenses (Costs)
        const costs = await prisma.cost.findMany({
            where: {
                isRecurring: false,
                date: {
                    gte: start,
                    lte: end
                }
            }
        });

        const totalExpenses = costs.reduce((sum, c) => sum + Number(c.amount), 0);

        // 3. Calculate Trend (Last 6 months)
        // We'll iterate back from current date
        const trend = [];
        const today = new Date();

        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
            const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
            const monthLabel = monthStart.toLocaleString('es-ES', { month: 'short' });

            // Monthly Income
            const monthlyIncomeAgg = await prisma.transaction.aggregate({
                where: {
                    status: 'COMPLETED',
                    updatedAt: { gte: monthStart, lte: monthEnd }
                },
                _sum: { total: true }
            });

            // Monthly Expenses
            const monthlyExpensesAgg = await prisma.cost.aggregate({
                where: {
                    isRecurring: false,
                    date: { gte: monthStart, lte: monthEnd }
                },
                _sum: { amount: true }
            });

            trend.push({
                month: monthLabel,
                income: Number(monthlyIncomeAgg._sum.total || 0),
                expenses: Number(monthlyExpensesAgg._sum.amount || 0)
            });
        }

        res.json({
            kpi: {
                totalIncome,
                totalExpenses,
                netBalance: totalIncome - totalExpenses,
                margin: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0
            },
            trend,
            period: { start, end }
        });

        // ... (existing logic)
        res.json({
            kpi: {
                totalIncome,
                totalExpenses,
                netBalance: totalIncome - totalExpenses,
                margin: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0
            },
            trend,
            period: { start, end }
        });

    } catch (error: any) {
        console.error('Get Financial Report Error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ message: 'Internal server error', details: error.message });
    }
};

function recurringPeriodRange(period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || Number(period.slice(0, 4)) < 1900) {
        throw new RangeError('Período inválido: use YYYY-MM');
    }
    const [year, month] = period.split('-').map(Number);
    return { gte: new Date(Date.UTC(year!, month! - 1, 1)), lt: new Date(Date.UTC(year!, month!, 1)) };
}

function recurringExecutionWhere(id: string, period: string) {
    return {
        recurringParentId: id,
        OR: [
            { recurringPeriod: period },
            // Preserve the original month of legacy payments without moving their payment date.
            { recurringPeriod: null, date: recurringPeriodRange(period) }
        ]
    };
}

export const getMonthlyRecurringStatus = async (req: Request, res: Response) => {
    try {
        const { month, year } = z.object({
            month: z.coerce.number().int().min(1).max(12),
            year: z.coerce.number().int().min(1900).max(9999)
        }).parse(req.query);
        const period = `${year}-${String(month).padStart(2, '0')}`;
        const templates = await prisma.cost.findMany({
            where: { isRecurring: true }, include: { category: true, branch: true }
        });
        const statusList = await Promise.all(templates.map(async template => {
            const execution = await prisma.cost.findFirst({
                where: recurringExecutionWhere(template.id, period), orderBy: { createdAt: 'asc' }
            });
            return { template, status: execution ? 'PAID' : 'PENDING', execution: execution || null };
        }));
        res.json(statusList);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ message: 'Mes y año inválidos' });
        console.error('Get Monthly Recurring Status Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const payRecurringCost = async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const data = z.object({
            date: z.string().datetime(),
            period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
            amount: z.number().finite().min(0.01).max(99999999.99).multipleOf(0.01).optional()
        }).parse(req.body);
        const period = data.period || data.date.slice(0, 7);
        recurringPeriodRange(period);
        const result = await prisma.$transaction(async tx => {
            // Serialize all payments for this template, including checks against legacy rows.
            await tx.$queryRaw`SELECT id FROM inventa_clinical_app.costs WHERE id = ${id} FOR UPDATE`;
            const template = await tx.cost.findUnique({ where: { id } });
            if (!template) return { ok: false, error: 'Costo recurrente no encontrado', status: 404 } as const;
            if (!template.isRecurring) return { ok: false, error: 'El costo no es recurrente', status: 400 } as const;
            if (await tx.cost.findFirst({ where: recurringExecutionWhere(id, period) })) {
                return { ok: false, error: 'Este período ya tiene un pago registrado', status: 409 } as const;
            }
            const cost = await tx.cost.create({
                data: {
                    categoryId: template.categoryId, description: template.description,
                    amount: data.amount ?? template.amount, date: new Date(data.date),
                    recurringPeriod: period, isRecurring: false, recurringParentId: id,
                    branchId: template.branchId, notes: `Pago recurrente ${period}: ${template.recurrenceRule}`,
                    createdBy: req.user?.userId
                }
            });
            return { ok: true, cost } as const;
        });
        if (!result.ok) return res.status(result.status).json({ message: result.error });
        res.status(201).json(result.cost);
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof RangeError) return res.status(400).json({ message: 'Datos de pago inválidos' });
        if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
            return res.status(409).json({ message: 'Este período ya tiene un pago registrado' });
        }
        console.error('Pay Recurring Cost Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
