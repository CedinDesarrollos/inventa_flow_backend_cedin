import { Router } from 'express';
import { getTariffs, getTariff, createTariff, updateTariff, deleteTariff, resolvePrice } from '../controllers/tariff.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

// Price Resolution (Must be first)
router.get('/resolve-price', resolvePrice);

// List
router.get('/', getTariffs);

// Specific Resource (Global/Default)
router.get('/:insuranceId/:serviceId', getTariff);
router.put('/:insuranceId/:serviceId', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), updateTariff);
router.delete('/:insuranceId/:serviceId', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), deleteTariff);

// Specific Resource (Professional Specific)
// Usage: /:ins/:svc/:profId (where profId can be a UUID or 'global')
router.get('/:insuranceId/:serviceId/:professionalId', getTariff);
router.put('/:insuranceId/:serviceId/:professionalId', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), updateTariff);
router.delete('/:insuranceId/:serviceId/:professionalId', requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY']), deleteTariff);

export default router;
