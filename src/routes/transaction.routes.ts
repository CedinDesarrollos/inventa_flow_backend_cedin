import { Router } from 'express';
import { getTransactions, getTransaction, createTransaction, voidTransaction } from '../controllers/transaction.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getTransactions);
router.get('/:id', getTransaction);
router.post('/', createTransaction);
router.patch('/:id/void', requireRole(['ADMIN', 'DEVELOPER']), voidTransaction);

export default router;
