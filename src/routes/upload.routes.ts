import { authenticateToken } from '../middleware/auth.middleware';
import { Router } from 'express';
import { upload, uploadFile } from '../controllers/upload.controller';

const router = Router();

router.use(authenticateToken);

// POST /api/upload
router.post('/', upload.single('file'), uploadFile);

export default router;
