import { Router } from 'express';
import { optionalAuthenticate } from '../middlewares/authenticate';
import { chat } from '../controllers/ai.controller';

const router = Router();

router.post('/chat', optionalAuthenticate, chat);

export default router;
