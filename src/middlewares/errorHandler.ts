import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error('[ERROR]', err);

  if (res.headersSent) return;

  res.status(500).json({ message: 'Internal server error' });
}
