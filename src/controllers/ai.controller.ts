import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import prisma from '../prisma/client';
import {
  consumeAiBurstSlot,
  diagnose,
  refundAiBurstSlot,
  refundDailyAiRequest,
  reserveDailyAiRequest,
} from '../services/ai.service';

const MAX_MESSAGE_LENGTH = 2_000;

export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { message } = req.body ?? {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
      return;
    }

    const userId = req.userId!;
    const burstReservation = consumeAiBurstSlot(userId);
    if (!burstReservation.allowed) {
      res.set('Retry-After', String(burstReservation.retryAfterSeconds));
      res.status(429).json({ error: 'AI request rate limit exceeded' });
      return;
    }

    let dailyReserved = false;
    try {
      const dailyReservation = await reserveDailyAiRequest(userId);
      if (!dailyReservation.allowed) {
        refundAiBurstSlot(userId);
        res.set('Retry-After', String(dailyReservation.retryAfterSeconds));
        res.status(429).json({ error: 'AI daily request limit exceeded' });
        return;
      }
      dailyReserved = true;

      const [user, history] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } }),
        prisma.aiChatHistory.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { question: true, legalAdvice: true },
        }),
      ]);
      const nickname = user?.nickname ?? undefined;
      const recentHistory = history.reverse();

      const result = await diagnose(trimmedMessage, nickname, recentHistory);

      if (result.chatEnded && result.status === 'relevant') {
        prisma.aiChatHistory.create({
          data: {
            userId,
            question: trimmedMessage,
            situationSummary: result.situationSummary,
            legalAdvice: result.legalAdvice,
            suggestions: result.suggestions,
          },
        }).catch(() => {});
      }

      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (err) {
      if (dailyReserved) {
        try {
          await refundDailyAiRequest(userId);
        } catch (refundError) {
          console.error('[AI quota refund failed]', refundError);
        }
      }
      next(err);
    }
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const history = await prisma.aiChatHistory.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        question: true,
        situationSummary: true,
        legalAdvice: true,
        suggestions: true,
        createdAt: true,
      },
    });
    res.json(history);
  } catch (err) {
    next(err);
  }
}
