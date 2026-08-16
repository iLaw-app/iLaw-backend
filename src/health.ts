import { Router } from 'express';

export interface ReadinessClient {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

export function createHealthRouter(database: ReadinessClient): Router {
  const router = Router();

  const live = (_req: unknown, res: { json(body: unknown): unknown }) => res.json({ status: 'ok' });
  router.get('/', live);
  router.get('/live', live);
  router.get('/ready', async (_req, res) => {
    try {
      await database.$queryRawUnsafe('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  return router;
}
