import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import * as whatsappController from '../controllers/whatsapp.controller';

const router = Router();

router.use(authenticateToken);


router.get('/status', whatsappController.getStatus);
router.post('/logout', whatsappController.logout);
router.post('/reconnect', whatsappController.reconnect);

export default router;
