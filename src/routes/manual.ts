import { Router } from 'express';
import { listCategories, listArticles, getArticle, listAgencies, searchArticles, scrapArticle, getScrapStatus, getMyScraps } from '../controllers/manual.controller';
import { authenticate } from '../middlewares/authenticate';

const router = Router();

router.get('/search', searchArticles);

router.get('/categories', listCategories);

router.get('/categories/:slug/articles', listArticles);

router.get('/articles/:id', getArticle);

router.get('/categories/:slug/agencies', listAgencies);

router.get('/my-scraps', authenticate, getMyScraps);
router.post('/articles/:id/scrap', authenticate, scrapArticle);
router.get('/articles/:id/scrap', authenticate, getScrapStatus);


export default router;
