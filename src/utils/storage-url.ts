export function buildPublicObjectUrl(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const cdnBaseUrl = env.AWS_CDN_BASE_URL?.trim().replace(/\/+$/, '');
  if (cdnBaseUrl) return `${cdnBaseUrl}/${key}`;

  const bucket = env.AWS_S3_BUCKET;
  const region = env.AWS_REGION;
  if (!bucket || !region) {
    throw new Error('AWS_S3_BUCKET and AWS_REGION are required to build an object URL');
  }

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
