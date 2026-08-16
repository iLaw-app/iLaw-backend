import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from './logging';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  // Map known Prisma errors to meaningful statuses instead of a blanket 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ message: '이미 사용 중인 값입니다.' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ message: '대상을 찾을 수 없습니다.' });
      return;
    }
  }

  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({
    event: 'request_error',
    requestId: req.id,
    method: req.method,
    path: req.path,
    error: error.message,
    stack: error.stack,
  });
  res.status(500).json({ message: 'Internal server error', requestId: req.id });
}
