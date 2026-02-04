import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import * as costController from '../controllers/cost.controller';

const router = Router();

// All routes require authentication and ADMIN/DEVELOPER role
router.use(authenticateToken);
router.use(requireRole(['ADMIN', 'DEVELOPER']));

// ========== COST CATEGORIES ==========
router.get('/cost-categories', costController.getCategories);
router.post('/cost-categories', costController.createCategory);
router.put('/cost-categories/:id', costController.updateCategory);
router.delete('/cost-categories/:id', costController.deleteCategory);

// ========== COSTS ==========
router.get('/costs', costController.getCosts);
router.post('/costs', costController.createCost);
router.put('/costs/:id', costController.updateCost);
router.delete('/costs/:id', costController.deleteCost);

// ========== REPORTS & RECURRING ==========
router.get('/costs/reports/financial', costController.getFinancialReport);
router.get('/costs/summary', costController.getCostSummary);
router.get('/costs/recurring/preview', costController.getRecurringPreview);
router.get('/costs/recurring/status', costController.getMonthlyRecurringStatus);
router.post('/costs/recurring/:id/pay', costController.payRecurringCost);

export default router;
