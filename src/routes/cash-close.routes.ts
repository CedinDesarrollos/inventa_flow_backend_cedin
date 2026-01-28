import { Router } from 'express';
import { getCashCloseStatus, signCashClose } from '../controllers/cash-close.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, getCashCloseStatus);
router.post('/sign', authenticateToken, signCashClose);

export default router;
