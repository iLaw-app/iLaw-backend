import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import {
  AiInputError,
  executeChat,
  getConversation as getConversationUseCase,
  getHistory as getHistoryUseCase,
  listConversations as listConversationsUseCase,
} from '../services/ai.use-case';
import { InvalidAiCursorError, type AiPageResult } from '../services/ai.repository';
import {
  observeAiBackgroundTask,
  type AiDeferredTask,
} from '../services/ai.background';
import { logger } from '../middlewares/logging';
import { safeAiErrorFields } from '../services/ai.logging';

class AiRequestExecutionError extends Error {
  constructor() {
    super('AI request failed');
    this.name = 'AiRequestExecutionError';
    this.stack = undefined;
  }
}

function sendInputError(
  error: unknown,
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof AiInputError || error instanceof InvalidAiCursorError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error({
    event: 'ai_request_failed',
    requestId: req.id,
    ...safeAiErrorFields(error, 'request_execution'),
  });
  next(new AiRequestExecutionError());
}

const PAGINATION_EXPOSE_HEADERS = 'X-Next-Cursor, X-Pagination-Limit';

function sendPage<T>(res: Response, page: AiPageResult<T>): void {
  res.set('X-Pagination-Limit', String(page.limit));
  res.set('Access-Control-Expose-Headers', PAGINATION_EXPOSE_HEADERS);
  if (page.nextCursor !== undefined) res.set('X-Next-Cursor', page.nextCursor);
  res.json(page.data);
}

interface FinishEmitter {
  once(event: 'finish', listener: () => void): unknown;
}

export function startAiBackgroundTasksAfterFinish(
  response: FinishEmitter,
  tasks: AiDeferredTask[],
): void {
  if (tasks.length === 0) return;
  response.once('finish', () => {
    for (const task of tasks) observeAiBackgroundTask(task.start, task.context);
  });
}

export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await executeChat(req.body, {
      requestId: req.id,
      userId: req.userId!,
    });
    if (!result.ok) {
      if (result.retryAfterSeconds !== undefined) {
        res.set('Retry-After', String(result.retryAfterSeconds));
      }
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.set('Cache-Control', 'no-store');
    startAiBackgroundTasksAfterFinish(res, result.backgroundTasks);
    res.json(result.body);
  } catch (error) {
    sendInputError(error, req, res, next);
  }
}

export async function getHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    sendPage(res, await getHistoryUseCase(req.userId!, req.query));
  } catch (error) {
    sendInputError(error, req, res, next);
  }
}

export async function listConversations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    sendPage(res, await listConversationsUseCase(req.userId!, req.query));
  } catch (error) {
    sendInputError(error, req, res, next);
  }
}

export async function getConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversation = await getConversationUseCase(req.userId!, req.params.id, req.query);
    if (!conversation) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    sendPage(res, conversation);
  } catch (error) {
    sendInputError(error, req, res, next);
  }
}
