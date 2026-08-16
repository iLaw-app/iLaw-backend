import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  createS3Client,
  createUploadService,
  StorageUnavailableError,
  type S3Sender,
} from '../src/services/upload.service';

const env = {
  AWS_S3_BUCKET: 'test-bucket',
  AWS_REGION: 'ap-northeast-2',
};

describe('upload service', () => {
  const send = vi.fn();
  const client: S3Sender = { send };

  beforeEach(() => {
    send.mockReset().mockResolvedValue({});
  });

  it('configures an explicit SDK retry budget and timeout-capable request handler', async () => {
    const s3 = createS3Client(env);

    expect(await s3.config.maxAttempts()).toBe(2);
    expect(s3.config.requestHandler).toBeInstanceOf(NodeHttpHandler);
    s3.destroy();
  });

  it('stores only the sanitized bytes with a server-selected content type and extension', async () => {
    const input = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffaa00' },
    }).png().withMetadata({ orientation: 1 }).toBuffer();
    const upload = createUploadService(client, env);

    const url = await upload(input);

    expect(url).toMatch(/^https:\/\/test-bucket\.s3\.ap-northeast-2\.amazonaws\.com\/uploads\/[\w-]+\.png$/);
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command.input.Bucket).toBe('test-bucket');
    expect(command.input.ContentType).toBe('image/png');
    expect(command.input.Key).toMatch(/^uploads\/[\w-]+\.png$/);
    expect(command.input.Body).toBeInstanceOf(Buffer);
    expect(command.input.Body).not.toEqual(input);
  });

  it('maps S3 failures to a storage-unavailable error without retrying outside the SDK budget', async () => {
    send.mockRejectedValue(new Error('socket timeout'));
    const upload = createUploadService(client, env);
    const input = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    }).jpeg().toBuffer();

    await expect(upload(input)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(send).toHaveBeenCalledOnce();
  });
});
