import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { accessLogger, requestId } from '../src/middlewares/logging';

describe('request logging', () => {
  it('accepts a safe request id and emits structured access data', async () => {
    const write = vi.fn();
    const app = express();
    app.use(requestId);
    app.use(accessLogger({ info: write }));
    app.get('/ok', (req, res) => res.json({ requestId: req.id }));

    const response = await request(app).get('/ok?token=must-not-be-logged').set('x-request-id', 'req-123');
    expect(response.headers['x-request-id']).toBe('req-123');
    expect(response.body.requestId).toBe('req-123');
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ event: 'http_request', requestId: 'req-123', method: 'GET', path: '/ok', status: 200 }));
  });

  it('replaces unsafe request ids', async () => {
    const app = express();
    app.use(requestId);
    app.get('/', (_req, res) => res.sendStatus(204));
    const response = await request(app).get('/').set('x-request-id', 'contains spaces');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
