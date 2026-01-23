import { Router } from 'express';
import { AutomationController } from '../controllers/automation.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new AutomationController();

// Protected routes (require valid JWT)
router.use(authenticateToken);

router.get('/', controller.getAll);
router.patch('/:key', controller.toggle);

export default router;
