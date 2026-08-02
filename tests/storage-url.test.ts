import { describe, expect, it } from 'vitest';
import { buildPublicObjectUrl } from '../src/utils/storage-url';

describe('buildPublicObjectUrl', () => {
  it('uses the CloudFront base URL when configured', () => {
    expect(buildPublicObjectUrl('uploads/photo.jpg', {
      AWS_CDN_BASE_URL: 'https://cdn.example.com/',
      AWS_S3_BUCKET: 'bucket',
      AWS_REGION: 'ap-northeast-2',
    })).toBe('https://cdn.example.com/uploads/photo.jpg');
  });

  it('falls back to the direct S3 URL outside CDN environments', () => {
    expect(buildPublicObjectUrl('uploads/photo.jpg', {
      AWS_S3_BUCKET: 'bucket',
      AWS_REGION: 'ap-northeast-2',
    })).toBe('https://bucket.s3.ap-northeast-2.amazonaws.com/uploads/photo.jpg');
  });

  it('rejects incomplete fallback configuration', () => {
    expect(() => buildPublicObjectUrl('uploads/photo.jpg', {})).toThrow(
      'AWS_S3_BUCKET and AWS_REGION are required',
    );
  });
});
