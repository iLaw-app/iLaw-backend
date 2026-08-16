import sharp from 'sharp';

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

export interface SanitizedImage {
  buffer: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

type AllowedFormat = 'jpeg' | 'png' | 'webp';

function detectSignature(buffer: Buffer): AllowedFormat | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return undefined;
}

const outputByFormat = {
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
} as const;

const MAX_DIMENSION = 10_000;
const MAX_PIXELS = 25_000_000;

export async function sanitizeImage(buffer: Buffer): Promise<SanitizedImage> {
  const signatureFormat = detectSignature(buffer);
  if (!signatureFormat) {
    throw new UploadValidationError('Unsupported or invalid image');
  }

  try {
    const image = sharp(buffer, { failOn: 'warning', limitInputPixels: MAX_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== signatureFormat) throw new UploadValidationError('Unsupported or invalid image');
    if (!metadata.width || !metadata.height
      || metadata.width > MAX_DIMENSION
      || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_PIXELS) {
      throw new UploadValidationError('Image dimensions exceed safe limits');
    }
    const rotated = image.rotate();
    const sanitized = signatureFormat === 'jpeg'
      ? await rotated.jpeg().toBuffer()
      : signatureFormat === 'png'
        ? await rotated.png().toBuffer()
        : await rotated.webp().toBuffer();
    return {
      buffer: sanitized,
      ...outputByFormat[signatureFormat],
    };
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError('Unsupported or invalid image');
  }
}
