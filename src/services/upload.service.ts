import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { randomUUID } from 'crypto';
import { buildPublicObjectUrl } from '../utils/storage-url';
import { sanitizeImage } from './upload-image.validation';

export interface S3Sender {
  send(command: PutObjectCommand): Promise<unknown>;
}

export class StorageUnavailableError extends Error {
  constructor() {
    super('Image storage is temporarily unavailable');
    this.name = 'StorageUnavailableError';
  }
}

export function createS3Client(env: NodeJS.ProcessEnv = process.env): S3Client {
  const credentials = env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined;
  return new S3Client({
    region: env.AWS_REGION,
    credentials,
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 2_000,
      requestTimeout: 5_000,
    }),
  });
}

export function createUploadService(
  client: S3Sender,
  env: NodeJS.ProcessEnv = process.env,
): (buffer: Buffer, folder?: string) => Promise<string> {
  return async (buffer: Buffer, folder = 'uploads'): Promise<string> => {
    const bucket = env.AWS_S3_BUCKET;
    if (!bucket) throw new StorageUnavailableError();

    const image = await sanitizeImage(buffer);
    const key = `${folder}/${randomUUID()}.${image.extension}`;

    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: image.buffer,
        ContentType: image.contentType,
      }));
    } catch {
      throw new StorageUnavailableError();
    }

    return buildPublicObjectUrl(key, env);
  };
}

const s3 = createS3Client();
export const uploadToS3 = createUploadService(s3);
