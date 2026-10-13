import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import { getClinicalRecords, createClinicalRecord } from '../controllers/clinical-record.controller';

const router = Router();

router.use(authenticateToken);

router.get('/:patientId', getClinicalRecords);
router.post('/', createClinicalRecord);

export default router;
