import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import { getDashboardKpis, getNpsStats, getReminderStats, getReminderDetails } from '../controllers/reports.controller';

const router = Router();

router.use(authenticateToken);

router.get('/kpis', getDashboardKpis);
router.get('/nps', getNpsStats);
router.get('/reminders', getReminderStats);
router.get('/reminders/details', getReminderDetails);

export default router;
