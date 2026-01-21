import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    resetPassword
} from '../controllers/user.controller';

const router = Router();

router.get('/', authenticateToken, getUsers);
router.post('/', authenticateToken, createUser);
router.put('/:id', authenticateToken, updateUser);
router.delete('/:id', authenticateToken, deleteUser);
router.post('/:id/reset-password', authenticateToken, resetPassword);

export default router;
