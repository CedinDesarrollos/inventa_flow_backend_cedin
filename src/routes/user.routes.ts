import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    resetPassword
} from '../controllers/user.controller';

const router = Router();

router.get('/', authenticateToken, getUsers);
router.post('/', authenticateToken, requireRole(['ADMIN', 'DEVELOPER']), createUser);
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'DEVELOPER']), updateUser);
router.delete('/:id', authenticateToken, requireRole(['ADMIN', 'DEVELOPER']), deleteUser);
router.post('/:id/reset-password', authenticateToken, requireRole(['ADMIN', 'DEVELOPER']), resetPassword);

export default router;
