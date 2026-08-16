import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { getUserNotifications, markAllRead, getUnreadCount } from '../services/notification.service';
import { setPaginationHeaders } from '../utils/http';
import { validateNotificationListQuery } from '../utils/validation';

export async function listNotifications(req: AuthRequest, res: Response) {
  const parsed = validateNotificationListQuery(req.query as Record<string, unknown>);
  if ('error' in parsed) { res.status(400).json({ message: '요청 내용을 확인해주세요.' }); return; }
  const notifications = await getUserNotifications(req.userId!, parsed.data);
  setPaginationHeaders(res, parsed.data);
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
