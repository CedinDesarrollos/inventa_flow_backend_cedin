import { Router } from 'express';
import { login, register, forgotPassword, resetPassword, changePassword, verifyPin, changePin } from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/change-password', authenticateToken, changePassword);
router.post('/verify-pin', authenticateToken, verifyPin);
router.post('/change-pin', authenticateToken, changePin);

export default router;
