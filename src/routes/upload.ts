import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middlewares/authenticate';
import { createRateLimiter } from '../middlewares/rateLimit';
import { uploadImage } from '../controllers/upload.controller';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

export function uploadRateLimitKey(req: Request): string {
  const authReq = req as AuthRequest;
  if (authReq.userId) return `user:${authReq.userId}`;
  return `anonymous:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
}

export const uploadRateLimiter = createRateLimiter({
  windowMs: ONE_DAY_MS,
  max: Number(process.env.UPLOAD_DAILY_LIMIT ?? 50),
  maxKeys: Number(process.env.UPLOAD_RATE_LIMIT_MAX_KEYS ?? 100_000),
  keyGenerator: uploadRateLimitKey,
  message: 'Upload daily rate limit exceeded',
});

function parseSingleImage(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, (error?: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ message: 'File size must be under 5MB' });
      return;
    }
    if (error) {
      res.status(400).json({ message: 'Invalid multipart upload' });
      return;
    }
    next();
  });
}

const router = Router();
router.post('/image', authenticate, uploadRateLimiter.middleware, parseSingleImage, uploadImage);

export default router;
