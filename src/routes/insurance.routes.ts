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
router.post('/', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), createInsurance);
router.put('/:id', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), updateInsurance);
router.delete('/:id', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), deleteInsurance);

// Tariffs
router.get('/:id/tariffs', getInsuranceTariffs);
router.put('/:id/tariffs', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), updateInsuranceTariffs);

export default router;
