import { Router } from 'express';
import { getAppointments, createAppointment, updateAppointment, updateAppointmentStatus, deleteAppointment } from '../controllers/appointment.controller';

const router = Router();

router.get('/', getAppointments);
router.post('/', createAppointment);
router.put('/:id', updateAppointment);
router.patch('/:id/status', updateAppointmentStatus);
router.delete('/:id', deleteAppointment);

export default router;
