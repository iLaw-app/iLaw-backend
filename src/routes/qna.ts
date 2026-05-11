import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { listPosts, listMyPosts, getPost, createPost, createAnswer } from '../controllers/qna.controller';

const router = Router();

router.get('/', listPosts);
router.get('/mine', authenticate, listMyPosts);
router.get('/:id', getPost);
router.post('/', authenticate, createPost);
router.post('/:id/answer', authenticate, createAnswer);

export default router;
