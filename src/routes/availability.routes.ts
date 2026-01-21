import { Router } from 'express';
import { getAvailableProfessionals, getAvailableSlots } from '../controllers/availability.controller';

const router = Router();

router.get('/professionals', getAvailableProfessionals);
router.get('/slots', getAvailableSlots);

export default router;
