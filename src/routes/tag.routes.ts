import { Router } from 'express';
import { getTags, createTag, deleteTag } from '../controllers/tag.controller';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

console.log('Loading tag routes...');

router.get('/', authenticateToken, getTags);
router.post('/', authenticateToken, requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), createTag);
router.delete('/:id', authenticateToken, requireRole(['ADMIN', 'PROFESSIONAL', 'DEVELOPER']), deleteTag);

export default router;
