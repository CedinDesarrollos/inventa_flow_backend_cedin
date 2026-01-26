import { Router } from 'express';
import { getAppointments, createAppointment, updateAppointment, updateAppointmentStatus, deleteAppointment, closeDailyAgenda } from '../controllers/appointment.controller';

const router = Router();

router.get('/', getAppointments);
router.post('/', createAppointment);
router.put('/:id', updateAppointment);
router.patch('/:id/status', updateAppointmentStatus);
router.delete('/:id', deleteAppointment);

router.post('/close-agenda', closeDailyAgenda);

export default router;
