import { Router } from 'express';
import { getDashboardKpis, getNpsStats, getReminderStats } from '../controllers/reports.controller';

const router = Router();

router.get('/kpis', getDashboardKpis);
router.get('/nps', getNpsStats);
router.get('/reminders', getReminderStats);

export default router;
