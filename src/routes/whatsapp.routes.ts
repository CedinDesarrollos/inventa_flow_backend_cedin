import { Router } from 'express';
import * as whatsappController from '../controllers/whatsapp.controller';
// import { authenticate } from '../middleware/auth'; // Ensure we protect these routes

const router = Router();

// TODO: Add authentication middleware
// router.use(authenticate);

router.get('/status', whatsappController.getStatus);
router.post('/logout', whatsappController.logout);
router.post('/reconnect', whatsappController.reconnect);

export default router;
