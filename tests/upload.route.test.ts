import express, { NextFunction, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthRequest } from '../src/middlewares/authenticate';

const uploadToS3Mock = vi.hoisted(() => vi.fn());

vi.mock('../src/middlewares/authenticate', () => ({
  authenticate: (req: AuthRequest, _res: Response, next: NextFunction) => {
    req.userId = String(req.header('x-user-id') ?? 'test-user');
    next();
  },
}));
vi.mock('../src/services/upload.service', () => ({
  uploadToS3: uploadToS3Mock,
  StorageUnavailableError: class StorageUnavailableError extends Error {},
}));

import uploadRouter, { uploadRateLimitKey } from '../src/routes/upload';
import { UploadValidationError } from '../src/services/upload-image.validation';
import { StorageUnavailableError } from '../src/services/upload.service';

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/upload', uploadRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: 'Internal server error' });
  });
  return app;
}

describe('upload endpoint', () => {
  beforeEach(() => {
    uploadToS3Mock.mockReset().mockResolvedValue('https://cdn.example.com/uploads/safe.jpg');
  });

  it('returns 413 when multipart input exceeds the existing 5MB limit', async () => {
    const response = await request(createApp())
      .post('/upload/image')
      .set('x-user-id', 'oversized-user')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'large.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(413);
    expect(uploadToS3Mock).not.toHaveBeenCalled();
  });

  it('keeps the successful response compatible as { url }', async () => {
    const response = await request(createApp())
      .post('/upload/image')
      .set('x-user-id', 'success-user')
      .attach('image', Buffer.from('image bytes'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ url: 'https://cdn.example.com/uploads/safe.jpg' });
  });

  it('returns 400 for an image rejected after decoding', async () => {
    uploadToS3Mock.mockRejectedValueOnce(new UploadValidationError('Unsupported or invalid image'));

    const response = await request(createApp())
      .post('/upload/image')
      .set('x-user-id', 'invalid-user')
      .attach('image', Buffer.from('<svg/>'), {
        filename: 'fake.svg',
        contentType: 'image/svg+xml',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Unsupported or invalid image' });
  });

  it('returns 503 when object storage is unavailable', async () => {
    uploadToS3Mock.mockRejectedValueOnce(new StorageUnavailableError());

    const response = await request(createApp())
      .post('/upload/image')
      .set('x-user-id', 'storage-user')
      .attach('image', Buffer.from('image bytes'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ message: 'Image storage is temporarily unavailable' });
  });

  it('returns 429 with Retry-After after the upload allowance is exhausted', async () => {
    const app = createApp();
    const sendUpload = () => request(app)
      .post('/upload/image')
      .set('x-user-id', 'limited-user')
      .set('x-forwarded-for', '203.0.113.10')
      .attach('image', Buffer.from('image bytes'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    for (let index = 0; index < 50; index += 1) {
      expect((await sendUpload()).status).toBe(201);
    }
    const response = await sendUpload();

    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(uploadToS3Mock).toHaveBeenCalledTimes(50);
  });

  it('uses both user ID and IP in the upload limiter key', () => {
    const req = {
      userId: 'user-1',
      ip: '203.0.113.10',
      socket: {},
    } as AuthRequest;

    expect(uploadRateLimitKey(req)).toBe('user-1:203.0.113.10');
    expect(uploadRateLimitKey({ ...req, userId: 'user-2' } as AuthRequest))
      .not.toBe(uploadRateLimitKey(req));
    expect(uploadRateLimitKey({ ...req, ip: '203.0.113.11' } as AuthRequest))
      .not.toBe(uploadRateLimitKey(req));
  });
});
