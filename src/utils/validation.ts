export const API_LIMITS = {
  qaTitle: 200,
  qaContent: 10_000,
  qaAnswer: 10_000,
  category: 100,
  imageUrls: 10,
  imageUrl: 2_048,
  searchQuery: 200,
  pageSize: 100,
} as const;

export type ValidationResult<T> = { data: T } | { error: string };
export type Pagination = { page: number; limit: number };

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parsePagination(query: Record<string, unknown>): ValidationResult<Pagination> {
  const page = query.page === undefined ? 1 : parsePositiveInteger(query.page);
  const limit = query.limit === undefined ? 20 : parsePositiveInteger(query.limit);
  if (
    page === null
    || limit === null
    || limit > API_LIMITS.pageSize
    || !Number.isSafeInteger((page - 1) * limit)
  ) {
    return { error: 'invalid_pagination' };
  }
  return { data: { page, limit } };
}

export function paginationArgs({ page, limit }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

function trimmedString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > maxLength) return null;
  return trimmed;
}

function allowedImageOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const origins = new Set<string>();
  const cdnBase = env.AWS_CDN_BASE_URL?.trim();
  if (cdnBase) {
    try {
      const url = new URL(cdnBase);
      if (url.protocol === 'https:') origins.add(url.origin);
    } catch {
      // Invalid deployment configuration cannot authorize an incoming URL.
    }
  }
  const bucket = env.AWS_S3_BUCKET?.trim();
  const region = env.AWS_REGION?.trim();
  if (bucket && region) origins.add(`https://${bucket}.s3.${region}.amazonaws.com`);
  return origins;
}

function validateImageUrls(value: unknown, env: NodeJS.ProcessEnv): ValidationResult<string[]> {
  if (value === undefined) return { data: [] };
  if (!Array.isArray(value) || value.length > API_LIMITS.imageUrls) {
    return { error: 'invalid_image_urls' };
  }
  const origins = allowedImageOrigins(env);
  const normalized: string[] = [];
  for (const item of value) {
    const raw = trimmedString(item, API_LIMITS.imageUrl);
    if (raw === null) return { error: 'invalid_image_urls' };
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || !origins.has(url.origin)) {
        return { error: 'invalid_image_urls' };
      }
      normalized.push(url.toString());
    } catch {
      return { error: 'invalid_image_urls' };
    }
  }
  return { data: normalized };
}

export type QAPostInput = {
  title: string;
  content: string;
  category: string;
  imageUrls: string[];
};

export function validateQAPost(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ValidationResult<QAPostInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid_qa_post' };
  const input = value as Record<string, unknown>;
  const title = trimmedString(input.title, API_LIMITS.qaTitle);
  const content = trimmedString(input.content, API_LIMITS.qaContent);
  const category = trimmedString(input.category, API_LIMITS.category);
  if (title === null || content === null || category === null) return { error: 'invalid_qa_post' };
  const imageUrls = validateImageUrls(input.imageUrls, env);
  if ('error' in imageUrls) return imageUrls;
  return { data: { title, content, category, imageUrls: imageUrls.data } };
}

export function validateQAAnswer(value: unknown): ValidationResult<{ content: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid_answer' };
  const content = trimmedString((value as Record<string, unknown>).content, API_LIMITS.qaAnswer);
  return content === null ? { error: 'invalid_answer' } : { data: { content } };
}

export function validateManualSearch(value: Record<string, unknown>): ValidationResult<{
  query: string;
  categorySlug?: string;
  debug: boolean;
}> {
  const query = trimmedString(value.q ?? '', API_LIMITS.searchQuery, true);
  if (query === null) return { error: 'invalid_query' };
  const categorySlug = value.categorySlug === undefined
    ? undefined
    : trimmedString(value.categorySlug, API_LIMITS.category);
  if (value.categorySlug !== undefined && categorySlug === null) return { error: 'invalid_query' };
  if (value.debug !== undefined && value.debug !== 'true' && value.debug !== 'false') {
    return { error: 'invalid_query' };
  }
  return {
    data: {
      query,
      ...(categorySlug !== undefined && categorySlug !== null && { categorySlug }),
      debug: value.debug === 'true',
    },
  };
}

export function validateNotificationListQuery(query: Record<string, unknown>): ValidationResult<Pagination> {
  if (Object.keys(query).some((key) => key !== 'page' && key !== 'limit')) {
    return { error: 'invalid_pagination' };
  }
  return parsePagination(query);
}
