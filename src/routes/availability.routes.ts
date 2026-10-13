import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import { getAvailableProfessionals, getAvailableSlots } from '../controllers/availability.controller';

const router = Router();

router.use(authenticateToken);

router.get('/professionals', getAvailableProfessionals);
router.get('/slots', getAvailableSlots);

export default router;
