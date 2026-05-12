import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { listNotifications, readAll, unreadCount } from '../controllers/notification.controller';

const router = Router();

router.get('/', authenticate, listNotifications);
router.get('/unread-count', authenticate, unreadCount);
router.patch('/read-all', authenticate, readAll);

export default router;
