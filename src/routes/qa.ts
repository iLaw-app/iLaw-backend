import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middlewares/authenticate';
import { listPosts, listMyPosts, listMyAnswers, getPost, createPost, createAnswer, scrapPost, getScrapStatus, getMyQAScraps, searchPosts, deletePost } from '../controllers/qa.controller';

const router = Router();

router.get('/', listPosts);
router.get('/search', searchPosts);
router.get('/mine', authenticate, listMyPosts);
router.get('/my-answers', authenticate, listMyAnswers);
router.get('/my-scraps', authenticate, getMyQAScraps);
router.get('/:id', optionalAuthenticate, getPost);
router.get('/:id/scrap', authenticate, getScrapStatus);
router.post('/', authenticate, createPost);
router.post('/:id/scrap', authenticate, scrapPost);
router.post('/:id/answer', authenticate, createAnswer);
router.delete('/:id', authenticate, deletePost);

export default router;
