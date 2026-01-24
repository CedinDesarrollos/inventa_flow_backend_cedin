import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    getPatients,
    getPatientById,
    createPatient,
    updatePatient,
    deletePatient,
    mergePatients
} from '../controllers/patient.controller';

const router = Router();

router.get('/', authenticateToken, getPatients);
router.get('/:id', authenticateToken, getPatientById);
router.post('/', authenticateToken, createPatient);
router.put('/:id', authenticateToken, updatePatient);
router.patch('/:id', authenticateToken, updatePatient);
router.post('/:id/merge', authenticateToken, mergePatients);
router.delete('/:id', authenticateToken, deletePatient);

export default router;
