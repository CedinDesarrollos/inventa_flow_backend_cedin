import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    getPatients,
    getPatientById,
    createPatient,
    updatePatient,
    deletePatient
} from '../controllers/patient.controller';

const router = Router();

router.get('/', authenticateToken, getPatients);
router.get('/:id', authenticateToken, getPatientById);
router.post('/', authenticateToken, createPatient);
router.put('/:id', authenticateToken, updatePatient);
router.delete('/:id', authenticateToken, deletePatient);

export default router;
