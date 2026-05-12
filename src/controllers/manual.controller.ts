import { Request, Response } from 'express';
import { getCategories, getArticlesByCategory, getArticleById, getAgencies, searchManualArticles } from '../services/manual.service';
import { toggleArticleScrap, getArticleScrapStatus, getUserScraps } from '../services/scrap.service';
import { AuthRequest } from '../middlewares/authenticate';

export async function listCategories(_req: Request, res: Response) {
  const categories = await getCategories();
  res.json(categories);
}

export async function listArticles(req: Request, res: Response) {
  const slug = req.params.slug as string;
  const articles = await getArticlesByCategory(slug);
  if (articles.length === 0) {
    res.status(404).json({ message: '카테고리를 찾을 수 없습니다.' });
    return;
  }
  res.json(articles);
}

export async function getArticle(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ message: '유효하지 않은 ID입니다.' });
    return;
  }
  const article = await getArticleById(id);
  if (!article) {
    res.status(404).json({ message: '아티클을 찾을 수 없습니다.' });
    return;
  }
  res.json(article);
}

export async function searchArticles(req: Request, res: Response) {
  const q = req.query.q as string;
  if (!q?.trim()) { res.json([]); return; }
  const categorySlug = req.query.categorySlug as string | undefined;
  const results = await searchManualArticles(q.trim(), categorySlug);
  res.json(results);
}

export async function listAgencies(req: Request, res: Response) {
  const slug = req.params.slug as string;
  const region = req.query.region as string | undefined;
  const agencies = await getAgencies(slug, region);
  res.json(agencies);
}

export async function scrapArticle(req: AuthRequest, res: Response) {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ message: '유효하지 않은 ID입니다.' }); return; }
  const result = await toggleArticleScrap(req.userId!, id);
  res.json(result);
}

export async function getScrapStatus(req: AuthRequest, res: Response) {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ message: '유효하지 않은 ID입니다.' }); return; }
  const result = await getArticleScrapStatus(req.userId!, id);
  res.json(result);
}

export async function getMyScraps(req: AuthRequest, res: Response) {
  const result = await getUserScraps(req.userId!);
  res.json(result);
}
