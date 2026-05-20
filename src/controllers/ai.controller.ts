import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import prisma from '../prisma/client';
import { diagnose } from '../services/ai.service';

export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    let nickname: string | undefined;
    if (req.userId) {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { nickname: true },
      });
      nickname = user?.nickname ?? undefined;
    }

    const result = await diagnose(message.trim(), nickname);

    if (req.userId && result.situationSummary) {
      prisma.aiChatHistory.create({
        data: {
          userId: req.userId,
          question: message.trim(),
          situationSummary: result.situationSummary,
          legalAdvice: result.legalAdvice,
          suggestions: result.suggestions,
        },
      }).catch(() => {});
    }

    res.json(result);
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
