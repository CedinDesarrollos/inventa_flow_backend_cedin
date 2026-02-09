import { Router } from 'express';
import { getNotifications, markAsRead } from '../controllers/notification.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);

export default router;
