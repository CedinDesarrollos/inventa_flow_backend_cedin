import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

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
    branchId: z.string().uuid().optional(),
    receiptUrl: z.string().url().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().positive().optional()
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
        const { startDate, endDate, categoryId, branchId } = req.query;
        const where: any = {};

        if (startDate && endDate) {
            where.date = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string)
            };
        }

        if (categoryId) where.categoryId = categoryId as string;
        if (branchId) where.branchId = branchId as string;

        const costs = await prisma.cost.findMany({
            where,
            include: {
                category: true,
                branch: true
            },
            orderBy: { date: 'desc' }
        });

        res.json(costs);
    } catch (error) {
        console.error('Get Costs Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createCost = async (req: Request, res: Response) => {
    try {
        const data = costSchema.parse(req.body);
        const userId = (req as any).user?.id;
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

        const where: any = {};

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

export const getMonthlyRecurringStatus = async (req: Request, res: Response) => {
    try {
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: 'Month and year are required' });
        }

        const targetMonth = parseInt(month as string);
        const targetYear = parseInt(year as string);

        // Define start and end of the target month
        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

        // 1. Get all active recurring templates
        const templates = await prisma.cost.findMany({
            where: { isRecurring: true },
            include: {
                category: true,
                branch: true
            }
        });

        // 2. Build the status list
        const statusList = await Promise.all(templates.map(async (template) => {
            // Find if there is an execution for this template in this month
            const execution = await prisma.cost.findFirst({
                where: {
                    recurringParentId: template.id,
                    date: {
                        gte: startDate,
                        lte: endDate
                    }
                }
            });

            return {
                template,
                status: execution ? 'PAID' : 'PENDING',
                execution: execution || null
            };
        }));

        res.json(statusList);
    } catch (error) {
        console.error('Get Monthly Recurring Status Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const payRecurringCost = async (req: Request, res: Response) => {
    try {
        // ID of the TEMPLATE cost
        const { id } = req.params;
        const { date, amount } = req.body;
        const userId = (req as any).user?.id;

        // 1. Fetch the template
        const template = await prisma.cost.findUnique({
            where: { id: id as string }
        });

        if (!template) {
            return res.status(404).json({ message: 'Recurring cost template not found' });
        }

        // 2. Create the execution record (Child)
        const newCost = await prisma.cost.create({
            data: {
                categoryId: template.categoryId,
                description: template.description, // Same description
                amount: amount ? Number(amount) : Number(template.amount), // Allow override or use template
                date: new Date(date), // Payment date
                isRecurring: false, // Execution is NOT recurring itself
                recurringParentId: template.id, // Link to parent
                branchId: template.branchId,
                notes: `Pago recurrente: ${template.recurrenceRule}`,
                createdBy: userId
            }
        });

        res.status(201).json(newCost);
    } catch (error) {
        console.error('Pay Recurring Cost Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
