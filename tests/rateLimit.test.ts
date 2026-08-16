import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../src/middlewares/rateLimit';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  it('bounds memory and fails closed only for each new identity once the store is full', async () => {
    const app = express();
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      maxKeys: 2,
      keyGenerator: (req) => String(req.header('x-client-id')),
    });
    app.use(limiter.middleware);
    app.get('/resource', (_req, res) => res.sendStatus(204));

    expect((await request(app).get('/resource').set('x-client-id', 'existing-a')).status).toBe(204);
    expect((await request(app).get('/resource').set('x-client-id', 'existing-b')).status).toBe(204);
    expect((await request(app).get('/resource').set('x-client-id', 'new-c')).status).toBe(429);
    expect((await request(app).get('/resource').set('x-client-id', 'new-d')).status).toBe(429);
    expect(limiter.storeSize()).toBe(2);

    // Capacity pressure neither evicts nor charges a shared overflow counter:
    // the already tracked identities retain their own independent allowance.
    expect((await request(app).get('/resource').set('x-client-id', 'existing-a')).status).toBe(204);
    expect((await request(app).get('/resource').set('x-client-id', 'existing-b')).status).toBe(204);
    limiter.stop();
  });

  it('removes expired entries before rejecting a new identity at capacity', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const app = express();
    const limiter = createRateLimiter({
      windowMs: 1_000,
      max: 1,
      maxKeys: 2,
      keyGenerator: (req) => String(req.header('x-client-id')),
    });
    app.use(limiter.middleware);
    app.get('/resource', (_req, res) => res.sendStatus(204));

    expect((await request(app).get('/resource').set('x-client-id', 'expired-a')).status).toBe(204);
    expect((await request(app).get('/resource').set('x-client-id', 'expired-b')).status).toBe(204);
    now = 2_001;
    expect((await request(app).get('/resource').set('x-client-id', 'new-c')).status).toBe(204);
    expect(limiter.storeSize()).toBe(1);
    limiter.stop();
  });
});
