import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import { getReminderStats, getReminderLogs, sendPendingReminders } from '../controllers/reminder.controller';

const router = Router();

router.use(authenticateToken);

// Get reminder statistics for dashboard
router.get('/stats', getReminderStats);

// Get reminder error logs
router.get('/logs', getReminderLogs);

// Manually trigger reminder sending (for testing)
router.post('/send-pending', sendPendingReminders);

export default router;
