
import { Router } from 'express';
import { getMedications, createMedication } from '../controllers/medication.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getMedications);
router.post('/', createMedication);

export default router;
