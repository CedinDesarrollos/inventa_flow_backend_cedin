import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const getProducts = async (req: Request, res: Response) => {
    try {
        const { branchId, lowStock } = req.query;

        const where: any = {};
        if (branchId) where.branchId = String(branchId);
        if (lowStock === 'true') {
            where.currentStock = {
                lte: prisma.product.fields.minStock
            };
        }

        const products = await prisma.product.findMany({
            where,
            orderBy: { name: 'asc' },
            include: {
                branch: {
                    select: { name: true }
                }
            }
        });

        res.json(products);
    } catch (error) {
        console.error('Get Products Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    try {
        const { name, sku, minStock, currentStock, costPrice, salePrice, unit, branchId } = req.body;

        const newProduct = await prisma.product.create({
            data: {
                name,
                sku,
                minStock: Number(minStock) || 5,
                currentStock: Number(currentStock) || 0,
                costPrice: Number(costPrice) || 0,
                salePrice: Number(salePrice) || 0,
                unit: unit || 'units',
                branchId,
                movements: currentStock > 0 ? {
                    create: {
                        type: 'ADJUSTMENT',
                        quantity: Number(currentStock),
                        notes: 'Initial Stock',
                        createdBy: (req as any).user?.userId
                    }
                } : undefined
            }
        });

        res.status(201).json(newProduct);
    } catch (error) {
        console.error('Create Product Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, sku, minStock, costPrice, salePrice, unit } = req.body;

        const updated = await prisma.product.update({
            where: { id: String(id) },
            data: {
                name,
                sku,
                minStock: Number(minStock),
                costPrice: Number(costPrice),
                salePrice: Number(salePrice),
                unit
            }
        });

        res.json(updated);
    } catch (error) {
        console.error('Update Product Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteProduct = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.product.update({
            where: { id: String(id) },
            data: { isActive: false }
        });
        res.json({ message: 'Product deactivated' });
    } catch (error) {
        console.error('Delete Product Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const adjustStock = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { quantity, type, notes } = req.body; // type: 'IN' | 'OUT' | 'ADJUSTMENT'

        // Transaction to ensure consistency
        const result = await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({ where: { id: String(id) } });
            if (!product) throw new Error('Product not found');

            let newStock = product.currentStock;
            const diff = Number(quantity);

            if (type === 'IN') newStock += diff;
            if (type === 'OUT') newStock -= diff;
            if (type === 'ADJUSTMENT') newStock = diff; // If adjustment, quantity IS the new stock? Or diff? usually Diff. Let's assume quantity is the CHANGE. Or if "ADJUSTMENT" usually means "Set to X".

            // Let's interpret ADJUSTMENT as "Set to X".
            // If type is ADJUSTMENT, quantity is the Absolute Value.
            let movementQty = 0;
            if (type === 'ADJUSTMENT') {
                movementQty = diff - product.currentStock;
                newStock = diff;
            } else {
                movementQty = type === 'OUT' ? -diff : diff;
            }

            const updatedProduct = await tx.product.update({
                where: { id: String(id) },
                data: { currentStock: newStock }
            });

            await tx.inventoryMovement.create({
                data: {
                    productId: String(id),
                    type,
                    quantity: movementQty, // Store the delta
                    notes,
                    createdBy: (req as any).user?.userId
                }
            });

            return updatedProduct;
        });

        res.json(result);
    } catch (error) {
        console.error('Adjust Stock Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
