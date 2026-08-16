import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { StorageUnavailableError, uploadToS3 } from '../services/upload.service';
import { UploadValidationError } from '../services/upload-image.validation';

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

  try {
    const url = await uploadToS3(file.buffer);
    res.status(201).json({ url });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      res.status(400).json({ message: error.message });
      return;
    }
    if (error instanceof StorageUnavailableError) {
      res.status(503).json({ message: 'Image storage is temporarily unavailable' });
      return;
    }
    throw error;
  }
}
