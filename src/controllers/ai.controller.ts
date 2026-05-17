import { Request, Response, NextFunction } from 'express';
import { diagnose } from '../services/ai.service';

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const result = await diagnose(message.trim());
    res.json(result);
  } catch (err) {
    next(err);
  }
}
