const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const DEVELOPMENT_DETAIL_LIMIT = 200;

type ErrorWithCode = Error & { code?: unknown };

function safeToken(value: unknown, fallback?: string): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : fallback;
}

/**
 * Production AI logs contain classification only. In development, a single-line,
 * 200-character message excerpt is added; stack traces are never emitted here.
 */
export function safeAiErrorFields(
  error: unknown,
  category: string,
): Record<string, unknown> {
  const known = error instanceof Error ? error as ErrorWithCode : undefined;
  const fields: Record<string, unknown> = {
    errorName: safeToken(known?.name, known ? 'Error' : 'NonErrorThrown'),
    errorCategory: category,
  };
  const code = safeToken(known?.code);
  if (code) fields.errorCode = code;

  if (process.env.NODE_ENV === 'development' && known?.message) {
    fields.errorDetail = known.message.replace(/\s+/g, ' ').trim().slice(0, DEVELOPMENT_DETAIL_LIMIT);
  }
  return fields;
}
