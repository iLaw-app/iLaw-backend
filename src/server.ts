import 'dotenv/config';
import './config/env';
import app from './app';
import { startServer } from './bootstrap';
import { logger } from './middlewares/logging';
import { globalRateLimiter } from './middlewares/rateLimit';
import prisma from './prisma/client';
import { cleanupExpiredOAuthRecords, OAUTH_CLEANUP_INTERVAL_MS } from './services/oauth.service';

async function main(): Promise<void> {
  await startServer({
    app,
    prisma,
    cleanup: cleanupExpiredOAuthRecords,
    cleanupIntervalMs: OAUTH_CLEANUP_INTERVAL_MS,
    port: process.env.PORT ?? 3000,
    shutdownDeadlineMs: Number(process.env.SHUTDOWN_DEADLINE_MS ?? 10_000),
    stopTasks: [globalRateLimiter.stop],
  });
}

main().catch(async (error) => {
  logger.error({
    event: 'bootstrap_failed',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
