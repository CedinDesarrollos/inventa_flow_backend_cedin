import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import { restrictAppointmentAccess } from '../middleware/appointment-access.middleware';
import { Router } from 'express';
import { getAppointments, createAppointment, updateAppointment, updateAppointmentStatus, deleteAppointment, closeDailyAgenda } from '../controllers/appointment.controller';

const router = Router();

router.use(authenticateToken, requireRole(['ADMIN', 'DEVELOPER', 'SECRETARY', 'PROFESSIONAL']));

router.get('/', restrictAppointmentAccess, getAppointments);
router.post('/', restrictAppointmentAccess, createAppointment);
router.put('/:id', restrictAppointmentAccess, updateAppointment);
router.patch('/:id/status', restrictAppointmentAccess, updateAppointmentStatus);
router.delete('/:id', restrictAppointmentAccess, deleteAppointment);

router.post('/close-agenda', restrictAppointmentAccess, closeDailyAgenda);

export default router;
