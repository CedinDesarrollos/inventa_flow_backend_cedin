import { Router } from 'express';
import { getNotifications, markAsRead } from '../controllers/notification.controller';

const router = Router();

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);

export default router;
