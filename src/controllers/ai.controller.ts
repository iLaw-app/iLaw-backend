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
    res.json(result);
  } catch (err) {
    next(err);
  }
}
