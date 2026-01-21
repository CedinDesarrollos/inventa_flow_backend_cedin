import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
    createVisit,
    getVisits,
    updateVisitStatus,
    getVisitById
} from '../controllers/medical-visit.controller';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createVisit);
router.get('/', getVisits);
router.get('/:id', getVisitById);
router.patch('/:id/status', updateVisitStatus);

export default router;
