import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    getProfessionals,
    createProfessional,
    updateProfessional,
    deleteProfessional
} from '../controllers/professional.controller';

const router = Router();

router.get('/', authenticateToken, getProfessionals);
router.post('/', authenticateToken, createProfessional);
router.put('/:id', authenticateToken, updateProfessional);
router.delete('/:id', authenticateToken, deleteProfessional);

export default router;
