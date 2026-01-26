import { Router } from 'express';
import {
    getInsurances,
    createInsurance,
    updateInsurance,
    deleteInsurance,
    getInsuranceTariffs,
    updateInsuranceTariffs
} from '../controllers/insurance.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

// Insurances CRUD
router.get('/', getInsurances);
router.post('/', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER', 'SECRETARY']), createInsurance);
router.put('/:id', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER', 'SECRETARY']), updateInsurance);
router.delete('/:id', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER', 'SECRETARY']), deleteInsurance);

// Tariffs
router.get('/:id/tariffs', getInsuranceTariffs);
router.put('/:id/tariffs', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER', 'SECRETARY']), updateInsuranceTariffs);

export default router;
