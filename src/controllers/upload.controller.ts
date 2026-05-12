import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { uploadToS3 } from '../services/upload.service';

export async function uploadImage(req: AuthRequest, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ message: 'No file uploaded' });
    return;
  }
  if (!file.mimetype.startsWith('image/')) {
    res.status(400).json({ message: 'Only image files are allowed' });
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    res.status(400).json({ message: 'File size must be under 5MB' });
    return;
  }

  const url = await uploadToS3(file.buffer, file.mimetype);
  res.status(201).json({ url });
}
