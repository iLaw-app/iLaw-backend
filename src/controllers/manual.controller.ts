import { Request, Response } from 'express';
import { getCategories, getArticlesByCategory, getArticleById, getAgencies, searchManualArticles } from '../services/manual.service';
import { toggleArticleScrap, getArticleScrapStatus, getUserScraps } from '../services/scrap.service';
import { AuthRequest } from '../middlewares/authenticate';
import { requireId, requirePagination, setPaginationHeaders } from '../utils/http';
import { validateManualSearch } from '../utils/validation';

const INVALID_ID = '유효하지 않은 ID입니다.';

export async function listCategories(_req: Request, res: Response) {
  const categories = await getCategories();
  res.json(categories);
}

export async function listArticles(req: Request, res: Response) {
  const slug = req.params.slug as string;
  const pagination = requirePagination(res, { page: req.query.page, limit: req.query.limit });
  if (!pagination) return;
  const articles = await getArticlesByCategory(slug, pagination);
  if (articles.length === 0 && pagination.page > 1) {
    setPaginationHeaders(res, pagination);
    res.json([]);
    return;
  }
  if (articles.length === 0) {
    res.status(404).json({ message: '카테고리를 찾을 수 없습니다.' });
    return;
  }
  setPaginationHeaders(res, pagination);
  res.json(articles);
}

export async function getArticle(req: Request, res: Response) {
  const id = requireId(res, req.params.id, INVALID_ID);
  if (id === null) return;
  const article = await getArticleById(id);
  if (!article) {
    res.status(404).json({ message: '아티클을 찾을 수 없습니다.' });
    return;
  }
  res.json(article);
}

export async function searchArticles(req: Request, res: Response) {
  const parsed = validateManualSearch(req.query as Record<string, unknown>);
  if ('error' in parsed) { res.status(400).json({ message: '검색어를 확인해주세요.' }); return; }
  if (!parsed.data.query) { res.json([]); return; }
  const { query, categorySlug, debug } = parsed.data;
  const results = await searchManualArticles(query, categorySlug, debug);
  res.json(results);
}

export async function listAgencies(req: Request, res: Response) {
  const slug = req.params.slug as string;
  const region = req.query.region as string | undefined;
  const pagination = requirePagination(res, { page: req.query.page, limit: req.query.limit });
  if (!pagination) return;
  const agencies = await getAgencies(slug, region, pagination);
  setPaginationHeaders(res, pagination);
  res.json(agencies);
}

export async function scrapArticle(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id, INVALID_ID);
  if (id === null) return;
  const result = await toggleArticleScrap(req.userId!, id);
  res.json(result);
}

export async function getScrapStatus(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id, INVALID_ID);
  if (id === null) return;
  const result = await getArticleScrapStatus(req.userId!, id);
  res.json(result);
}

export async function getMyScraps(req: AuthRequest, res: Response) {
  const result = await getUserScraps(req.userId!);
  res.json(result);
}
