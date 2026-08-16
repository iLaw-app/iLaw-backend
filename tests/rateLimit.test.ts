import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../src/middlewares/rateLimit';

afterEach(() => vi.useRealTimers());

describe('createRateLimiter', () => {
  it('allows requests up to the limit then returns 429 with rate headers', async () => {
    const app = express();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    app.use(limiter.middleware);
    app.get('/resource', (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/resource')).status).toBe(200);
    const second = await request(app).get('/resource');
    expect(second.status).toBe(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');
    const blocked = await request(app).get('/resource');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ message: 'Too many requests' });
    expect(blocked.headers['retry-after']).toBeDefined();
    limiter.stop();
  });

  it('can be reused for endpoint-specific keys and limits', async () => {
    const app = express();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyGenerator: (req) => String(req.header('x-user-id')) });
    app.get('/sensitive', limiter.middleware, (_req, res) => res.sendStatus(204));

    expect((await request(app).get('/sensitive').set('x-user-id', 'a')).status).toBe(204);
    expect((await request(app).get('/sensitive').set('x-user-id', 'a')).status).toBe(429);
    expect((await request(app).get('/sensitive').set('x-user-id', 'b')).status).toBe(204);
    limiter.stop();
  });
});
