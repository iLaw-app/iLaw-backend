import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { errorHandler } from '../src/middlewares/errorHandler';

function mockRes() {
  const res: any = { headersSent: false };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('errorHandler', () => {
  it('maps Prisma P2002 (unique violation) to 409', () => {
    const res = mockRes();
    const err = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' });
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('maps Prisma P2025 (not found) to 404', () => {
    const res = mockRes();
    const err = new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '5' });
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('falls back to 500 for unknown errors', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('does nothing when headers are already sent', () => {
    const res = mockRes();
    res.headersSent = true;
    errorHandler(new Error('boom'), {} as any, res, vi.fn());
    expect(res.status).not.toHaveBeenCalled();
  });
});
