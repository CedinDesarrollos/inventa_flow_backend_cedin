import { Router } from 'express';
import { getDashboardKpis } from '../controllers/reports.controller';

const router = Router();

router.get('/kpis', getDashboardKpis);

export default router;
