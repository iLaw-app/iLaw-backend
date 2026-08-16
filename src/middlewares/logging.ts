import { randomUUID } from 'crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export interface StructuredLogger {
  info(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
}

function emit(stream: NodeJS.WriteStream, fields: Record<string, unknown>): void {
  stream.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...fields })}\n`);
}

export const logger: StructuredLogger = {
  info: (fields) => emit(process.stdout, fields),
  error: (fields) => emit(process.stderr, fields),
};

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  req.id = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

export function accessLogger(output: Pick<StructuredLogger, 'info'> = logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      output.info({
        event: 'http_request',
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        ip: req.ip,
      });
    });
    next();
  };
}
