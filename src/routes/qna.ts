import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { listPosts, listMyPosts, getPost, createPost, createAnswer, scrapPost, getScrapStatus, getMyQnAScraps, searchPosts } from '../controllers/qna.controller';

const router = Router();

router.get('/', listPosts);
router.get('/search', searchPosts);
router.get('/mine', authenticate, listMyPosts);
router.get('/my-scraps', authenticate, getMyQnAScraps);
router.get('/:id', getPost);
router.get('/:id/scrap', authenticate, getScrapStatus);
router.post('/', authenticate, createPost);
router.post('/:id/scrap', authenticate, scrapPost);
router.post('/:id/answer', authenticate, createAnswer);

export default router;
