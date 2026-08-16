import { Request, RequestHandler } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  maxKeys?: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}

interface Entry {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  middleware: RequestHandler;
  storeSize(): number;
  stop(): void;
}

/**
 * In-memory fixed-window limiter for a single Railway instance. It intentionally
 * fails closed per process, but counters are not shared across replicas. Use a
 * Redis-backed store before scaling to multiple instances.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0 || !Number.isInteger(options.max) || options.max <= 0) {
    throw new Error('Rate limit windowMs and max must be positive');
  }
  const maxKeys = options.maxKeys ?? 100_000;
  if (!Number.isInteger(maxKeys) || maxKeys <= 0) throw new Error('Rate limit maxKeys must be a positive integer');

  const entries = new Map<string, Entry>();
  const removeExpired = (now: number) => {
    for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
  };
  const cleanupTimer = setInterval(() => {
    removeExpired(Date.now());
  }, Math.min(options.windowMs, 60_000));
  cleanupTimer.unref();

  const middleware: RequestHandler = (req, res, next) => {
    const now = Date.now();
    const key = options.keyGenerator?.(req) ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let entry = entries.get(key);
    if (entry?.resetAt !== undefined && entry.resetAt <= now) {
      entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      // Reclaim stale capacity first. If every slot is still active, reject only
      // this untracked identity; never evict a live counter or share overflow state.
      removeExpired(now);
      if (entries.size >= maxKeys) {
        const resetAt = now + options.windowMs;
        res.setHeader('RateLimit-Limit', String(options.max));
        res.setHeader('RateLimit-Remaining', '0');
        res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(options.windowMs / 1000))));
        res.status(429).json({ message: options.message ?? 'Too many requests' });
        return;
      }
      entry = { count: 0, resetAt: now + options.windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, options.max - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ message: options.message ?? 'Too many requests' });
      return;
    }
    next();
  };

  return { middleware, storeSize: () => entries.size, stop: () => clearInterval(cleanupTimer) };
}

const globalWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60_000);
const globalMax = Number(process.env.RATE_LIMIT_MAX ?? 300);
const globalMaxKeys = Number(process.env.RATE_LIMIT_MAX_KEYS ?? 100_000);

export const globalRateLimiter = createRateLimiter({
  windowMs: globalWindowMs,
  max: globalMax,
  maxKeys: globalMaxKeys,
});
