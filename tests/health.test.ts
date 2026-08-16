import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHealthRouter } from '../src/health';

function healthApp(query: () => Promise<unknown>) {
  const app = express();
  app.use('/health', createHealthRouter({ $queryRawUnsafe: query }));
  return app;
}

describe('health endpoints', () => {
  it('keeps liveness independent from database readiness', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database down'));
    const response = await request(healthApp(query)).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks the database for readiness', async () => {
    const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const response = await request(healthApp(query)).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the database is not ready', async () => {
    const response = await request(healthApp(vi.fn().mockRejectedValue(new Error('down')))).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
  });

  it('preserves the legacy /health response', async () => {
    const response = await request(healthApp(vi.fn())).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
