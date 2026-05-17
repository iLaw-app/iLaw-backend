import { GetObjectCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET!;

export async function uploadToS3(buffer: Buffer, mimetype: string, folder = 'uploads'): Promise<string> {
  const ext = mimetype.split('/')[1] ?? 'jpg';
  const key = `${folder}/${randomUUID()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }));

  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

export async function getUploadedImage(url: string) {
  const parsed = new URL(url);
  const expectedHost = `${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
  if (parsed.hostname !== expectedHost) {
    throw new Error('Invalid S3 image URL');
  }

  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!key.startsWith('uploads/')) {
    throw new Error('Invalid upload key');
  }

  const object = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
  const bytes = await object.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error('Empty S3 object body');
  }

  return {
    buffer: Buffer.from(bytes),
    contentType: object.ContentType ?? 'application/octet-stream',
  };
}
