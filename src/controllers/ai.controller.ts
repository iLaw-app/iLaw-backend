import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import {
  AiInputError,
  executeChat,
  getConversation as getConversationUseCase,
  getHistory as getHistoryUseCase,
  listConversations as listConversationsUseCase,
} from '../services/ai.use-case';

function sendInputError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AiInputError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
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
    res.json(result.body);
  } catch (error) {
    sendInputError(error, res, next);
  }
}

export async function getHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await getHistoryUseCase(req.userId!, req.query));
  } catch (error) {
    sendInputError(error, res, next);
  }
}

export async function listConversations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await listConversationsUseCase(req.userId!, req.query));
  } catch (error) {
    sendInputError(error, res, next);
  }
}

export async function getConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversation = await getConversationUseCase(req.userId!, req.params.id, req.query);
    if (!conversation) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    res.json(conversation);
  } catch (error) {
    sendInputError(error, res, next);
  }
}
