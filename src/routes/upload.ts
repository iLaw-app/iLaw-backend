import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/authenticate';
import { proxyUploadedImage, uploadImage } from '../controllers/upload.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/image', authenticate, upload.single('image'), uploadImage);
router.get('/image-proxy', proxyUploadedImage);

export default router;
