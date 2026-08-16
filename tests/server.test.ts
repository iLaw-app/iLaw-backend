import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/bootstrap';

describe('server bootstrap and shutdown', () => {
  it('checks database readiness before listening and manages cleanup lifecycle', async () => {
    const events: string[] = [];
    const prisma = {
      $queryRawUnsafe: vi.fn(async () => { events.push('db-ready'); }),
      $disconnect: vi.fn(async () => { events.push('db-disconnect'); }),
    };
    const cleanup = vi.fn(async () => { events.push('cleanup'); });
    const app = express();
    app.get('/', (_req, res) => res.sendStatus(204));

    const runtime = await startServer({ app, prisma, cleanup, cleanupIntervalMs: 60_000, port: 0, registerSignals: false });
    events.push('listening');
    expect(events.slice(0, 3)).toEqual(['db-ready', 'cleanup', 'listening']);
    expect(runtime.server.listening).toBe(true);

    await runtime.shutdown('test');
    expect(runtime.server.listening).toBe(false);
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(runtime.cleanupTimer).toBeUndefined();
  });

  it('rejects new requests after shutdown begins', async () => {
    const prisma = { $queryRawUnsafe: vi.fn().mockResolvedValue([]), $disconnect: vi.fn().mockResolvedValue(undefined) };
    const app = express();
    const runtime = await startServer({ app, prisma, cleanup: vi.fn().mockResolvedValue(undefined), cleanupIntervalMs: 60_000, port: 0, registerSignals: false });
    runtime.tracker.beginShutdown();
    const address = runtime.server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    const response = await request(`http://127.0.0.1:${address.port}`).get('/anything');
    expect(response.status).toBe(503);
    expect(response.headers.connection).toBe('close');
    await runtime.shutdown('test');
  });
});
