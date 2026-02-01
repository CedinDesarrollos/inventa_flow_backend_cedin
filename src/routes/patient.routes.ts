import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    getPatients,
    getPatientById,
    createPatient,
    updatePatient,
    deletePatient,
    mergePatients,
    addPatientRelationship,
    deletePatientRelationship
} from '../controllers/patient.controller';

const router = Router();

router.use(authenticateToken); // All routes require auth

router.get('/', getPatients);
router.post('/', createPatient);
router.get('/:id', getPatientById);
router.put('/:id', updatePatient);
router.patch('/:id', updatePatient); // Keep existing patch route
router.delete('/:id', deletePatient);
router.post('/:id/merge', mergePatients);

// Family Relationships
router.post('/:id/relationships', addPatientRelationship);
router.delete('/relationships/:relationshipId', deletePatientRelationship);

export default router;
