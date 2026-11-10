import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import { getAvailableProfessionals, getAvailableSlots, getDayWindows } from '../controllers/availability.controller';

const router = Router();

router.use(authenticateToken);

router.get('/professionals', getAvailableProfessionals);
router.get('/slots', getAvailableSlots);
router.get('/windows', getDayWindows);

export default router;
