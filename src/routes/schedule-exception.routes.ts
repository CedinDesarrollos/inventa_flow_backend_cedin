import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    listExceptions,
    replaceSiteDay,
    createOoo,
    reviewException,
    deleteException,
    listToReschedule
} from '../controllers/schedule-exception.controller';

const router = Router();
router.use(authenticateToken);

router.get('/', listExceptions);
router.get('/to-reschedule', listToReschedule);
router.put('/site-day', replaceSiteDay);
router.post('/ooo', createOoo);
router.patch('/:id/review', reviewException);
router.delete('/:id', deleteException);

export default router;
