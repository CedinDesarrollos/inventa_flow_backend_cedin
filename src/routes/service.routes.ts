import { Router } from 'express';
import { getServices, createService, updateService, deleteService } from '../controllers/service.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Public? Or protected? Services are usually protected configs.
router.use(authenticateToken);

router.get('/', getServices);
router.post('/', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), createService);
router.put('/:id', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), updateService);
router.delete('/:id', requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), deleteService);

export default router;
