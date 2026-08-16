import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Express, RequestHandler } from 'express';
import { logger, StructuredLogger } from './middlewares/logging';

interface PrismaLifecycle {
  $queryRawUnsafe(query: string): Promise<unknown>;
  $disconnect(): Promise<void>;
}

export class RequestTracker {
  private accepting = true;
  private inFlight = 0;
  private waiters: Array<() => void> = [];

  readonly middleware: RequestHandler = (_req, res, next) => {
    if (!this.accepting) {
      res.setHeader('Connection', 'close');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 503;
      res.end(JSON.stringify({ message: 'Server is shutting down' }));
      return;
    }
    this.inFlight += 1;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      this.inFlight -= 1;
      if (this.inFlight === 0) this.waiters.splice(0).forEach((resolve) => resolve());
    };
    res.once('finish', complete);
    res.once('close', complete);
    next();
  };

  beginShutdown(): void {
    this.accepting = false;
  }

  async drain(): Promise<void> {
    if (this.inFlight === 0) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

export interface StartServerOptions {
  app: Express;
  prisma: PrismaLifecycle;
  cleanup: () => Promise<unknown>;
  cleanupIntervalMs: number;
  port: number | string;
  shutdownDeadlineMs?: number;
  registerSignals?: boolean;
  output?: StructuredLogger;
  stopTasks?: Array<() => void>;
}

export interface ServerRuntime {
  server: Server;
  tracker: RequestTracker;
  cleanupTimer?: NodeJS.Timeout;
  shutdown(reason: string): Promise<void>;
}

export async function startServer(options: StartServerOptions): Promise<ServerRuntime> {
  const output = options.output ?? logger;
  const tracker = new RequestTracker();

  await options.prisma.$queryRawUnsafe('SELECT 1');
  await options.cleanup();

  // Wrap Express so lifecycle tracking is always the outermost middleware,
  // including when app routes and error handlers have already been mounted.
  const server = createServer((req, res) => {
    tracker.middleware(req as never, res as never, () => options.app(req, res));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  let cleanupTimer: NodeJS.Timeout | undefined = setInterval(() => {
    options.cleanup().catch((error) => output.error({ event: 'oauth_cleanup_failed', error: error instanceof Error ? error.message : String(error) }));
  }, options.cleanupIntervalMs);
  cleanupTimer.unref();
  let shutdownPromise: Promise<void> | undefined;

  const runtime: ServerRuntime = {
    server,
    tracker,
    cleanupTimer,
    shutdown(reason: string) {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        output.info({ event: 'shutdown_started', reason });
        tracker.beginShutdown();
        if (cleanupTimer) {
          clearInterval(cleanupTimer);
          cleanupTimer = undefined;
          runtime.cleanupTimer = undefined;
        }
        options.stopTasks?.forEach((stop) => stop());

        const closeServer = new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        });
        const graceful = Promise.all([closeServer, tracker.drain()]).then(() => undefined);
        const deadlineMs = options.shutdownDeadlineMs ?? 10_000;
        let deadline: NodeJS.Timeout | undefined;
        await Promise.race([
          graceful,
          new Promise<void>((resolve) => {
            deadline = setTimeout(() => {
              output.error({ event: 'shutdown_deadline_exceeded', deadlineMs });
              server.closeAllConnections?.();
              resolve();
            }, deadlineMs);
            deadline.unref();
          }),
        ]);
        if (deadline) clearTimeout(deadline);
        await options.prisma.$disconnect();
        output.info({ event: 'shutdown_complete', reason });
      })();
      return shutdownPromise;
    },
  };

  if (options.registerSignals !== false) {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        runtime.shutdown(signal).then(() => { process.exitCode = 0; }).catch((error) => {
          output.error({ event: 'shutdown_failed', error: error instanceof Error ? error.message : String(error) });
          process.exitCode = 1;
        });
      });
    }
  }

  const address = server.address() as AddressInfo | null;
  output.info({ event: 'server_listening', port: address?.port ?? options.port });
  return runtime;
}
