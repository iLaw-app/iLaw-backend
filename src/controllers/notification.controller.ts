import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { getUserNotifications, markAllRead, getUnreadCount } from '../services/notification.service';

export async function listNotifications(req: AuthRequest, res: Response) {
  const notifications = await getUserNotifications(req.userId!);
  res.json(notifications);
}

export async function readAll(req: AuthRequest, res: Response) {
  await markAllRead(req.userId!);
  res.json({ ok: true });
}

export async function unreadCount(req: AuthRequest, res: Response) {
  const count = await getUnreadCount(req.userId!);
  res.json({ count });
}
