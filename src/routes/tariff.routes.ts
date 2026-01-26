import { Router } from 'express';
import { getTariffs, getTariff, createTariff, updateTariff, deleteTariff } from '../controllers/tariff.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getTariffs);
router.get('/:insuranceId/:serviceId', getTariff);
router.post('/', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), createTariff);
router.put('/:insuranceId/:serviceId', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), updateTariff);
router.delete('/:insuranceId/:serviceId', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), deleteTariff);

export default router;
