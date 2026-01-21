import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/system-settings.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Only ADMIN and DEVELOPER should modify settings, but maybe PROFESSIONAL needs to see them?
// For now, let's protect updates with ADMIN role, but allow authenticated users to read.

router.get('/', authenticateToken, getSettings);
router.put('/', authenticateToken, requireRole(['ADMIN', 'DEVELOPER']), updateSettings);

export default router;
