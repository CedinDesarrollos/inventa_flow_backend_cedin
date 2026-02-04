import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import * as productController from '../controllers/product.controller';

const router = Router();

router.use(authenticateToken);

router.get('/', productController.getProducts);
router.post('/', requireRole(['ADMIN', 'PROFESSIONAL', 'SECRETARY']), productController.createProduct); // Secretary can add stock? Yes.
router.put('/:id', requireRole(['ADMIN', 'PROFESSIONAL']), productController.updateProduct);
router.delete('/:id', requireRole(['ADMIN']), productController.deleteProduct);
router.post('/:id/adjust', requireRole(['ADMIN', 'PROFESSIONAL', 'SECRETARY']), productController.adjustStock);

export default router;
