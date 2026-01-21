import { Router } from 'express';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../controllers/template.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, getTemplates);
router.post('/', authenticateToken, requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), createTemplate);
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), updateTemplate);
router.delete('/:id', authenticateToken, requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), deleteTemplate);

export default router;
