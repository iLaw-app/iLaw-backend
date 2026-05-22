import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middlewares/authenticate';
import { chat, getHistory } from '../controllers/ai.controller';

const router = Router();

router.post('/chat', optionalAuthenticate, chat);
router.get('/history', authenticate, getHistory);

export default router;
