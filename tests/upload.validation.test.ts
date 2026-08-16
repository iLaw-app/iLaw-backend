import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sanitizeImage, UploadValidationError } from '../src/services/upload-image.validation';

describe('sanitizeImage', () => {
  it('rejects HTML even when the client labels it as an image', async () => {
    const disguisedHtml = Buffer.from('<html><script>alert(1)</script></html>');

    await expect(sanitizeImage(disguisedHtml)).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects SVG input instead of rasterizing active content', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    await expect(sanitizeImage(svg)).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects corrupt data with a forged JPEG signature', async () => {
    const disguised = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html>not a jpeg</html>')]);

    await expect(sanitizeImage(disguised)).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('decodes and re-encodes a real JPEG with a server-selected type and extension', async () => {
    const input = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#ff0000' },
    }).jpeg().toBuffer();

    const result = await sanitizeImage(input);

    expect(result.contentType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
    expect((await sharp(result.buffer).metadata()).format).toBe('jpeg');
    expect(result.buffer).not.toBe(input);
  });

  it('normalizes EXIF orientation and removes metadata while re-encoding', async () => {
    const input = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#0000ff' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const result = await sanitizeImage(input);
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.width).toBe(3);
    expect(metadata.height).toBe(2);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it('rejects images with excessive dimensions before re-encoding', async () => {
    const oversized = await sharp({
      create: { width: 10_001, height: 1, channels: 3, background: '#ffffff' },
    }).png().toBuffer();

    await expect(sanitizeImage(oversized)).rejects.toThrow('Image dimensions exceed safe limits');
  });

  it('rejects images exceeding the total pixel budget', async () => {
    const oversized = await sharp({
      create: { width: 5_001, height: 5_000, channels: 3, background: '#ffffff' },
    }).png().toBuffer();

    await expect(sanitizeImage(oversized)).rejects.toBeInstanceOf(UploadValidationError);
  });

  it.each([
    ['PNG', 'png', 'image/png', 'png'],
    ['WebP', 'webp', 'image/webp', 'webp'],
  ] as const)('accepts and preserves the safe %s format', async (_label, encoder, contentType, extension) => {
    const pipeline = sharp({
      create: { width: 2, height: 2, channels: 4, background: '#00ff00ff' },
    });
    const input = await pipeline[encoder]().toBuffer();

    const result = await sanitizeImage(input);

    expect(result.contentType).toBe(contentType);
    expect(result.extension).toBe(extension);
    expect((await sharp(result.buffer).metadata()).format).toBe(extension);
  });
});
