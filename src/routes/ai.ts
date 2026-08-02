import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import {
  chat,
  getConversation,
  getHistory,
  listConversations,
} from '../controllers/ai.controller';

const router = Router();

router.post('/chat', authenticate, chat);
router.get('/history', authenticate, getHistory);
router.get('/conversations', authenticate, listConversations);
router.get('/conversations/:id', authenticate, getConversation);

export default router;
