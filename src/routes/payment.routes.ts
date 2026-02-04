import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import * as paymentController from '../controllers/payment.controller';

const router = Router();

router.use(authenticateToken);

// Payment routes
router.post(
    '/transactions/:id/payments',
    requireRole(['ADMIN', 'SECRETARY']),
    paymentController.createPayment
);

router.get(
    '/transactions/:id/payments',
    paymentController.getPayments
);

// Accounts receivable report
router.get(
    '/payments/accounts-receivable',
    requireRole(['ADMIN', 'DEVELOPER']),
    paymentController.getAccountsReceivable
);

export default router;
