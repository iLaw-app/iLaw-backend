import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { chat, getHistory } from '../controllers/ai.controller';

const router = Router();

router.post('/chat', authenticate, chat);
router.get('/history', authenticate, getHistory);

export default router;
