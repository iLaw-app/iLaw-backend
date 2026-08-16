import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { parseId, requireId, requirePagination, setPaginationHeaders } from '../utils/http';
import { listQAPosts, listUserQAPosts, getQAPostDetail, getQAPostAnswerState, createQAPost, createQAAnswer, searchQAPosts, listLawyerAnswers, deleteQAPost, updateQAAnswer } from '../services/qa.service';
import { toggleQAScrap, getQAScrapStatus, getUserQAScraps } from '../services/scrap.service';
import { createNotificationsForLawyers } from '../services/notification.service';
import { logger } from '../middlewares/logging';
import { validateQAAnswer, validateQAPost } from '../utils/validation';

export async function searchPosts(req: AuthRequest, res: Response) {
  const q = (req.query.q as string)?.trim();
  if (!q) { res.json([]); return; }
  const debug = req.query.debug === 'true';
  const { results, expandedTerms } = await searchQAPosts(q, debug);
  res.json({
    results: results.map(p => ({ ...p, author: { nickname: '익명' } })),
    expandedTerms,
  });
}

export async function listPosts(req: AuthRequest, res: Response) {
  const pagination = requirePagination(res, req.query as Record<string, unknown>);
  if (!pagination) return;
  const posts = await listQAPosts(req.userId, pagination);
  setPaginationHeaders(res, pagination);
  res.json(posts.map(p => ({ ...p, author: { nickname: '익명' } })));
}

export async function getPost(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id, 'Invalid id');
  if (id === null) return;
  const post = await getQAPostDetail(id, req.userId);
  if (!post) { res.status(404).json({ message: 'Not found' }); return; }
  res.json(post);
}

export async function updateAnswer(req: AuthRequest, res: Response) {
  const postId = parseId(req.params.id);
  const parsed = validateQAAnswer(req.body);
  if (postId === null || 'error' in parsed) {
    res.status(400).json({ message: 'postId and content are required' });
    return;
  }
  const updated = await updateQAAnswer(postId, req.userId!, parsed.data.content);
  if (!updated) { res.status(403).json({ message: 'Forbidden or not found' }); return; }
  res.json({ success: true });
}

export async function deletePost(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id, 'Invalid id');
  if (id === null) return;
  const deleted = await deleteQAPost(id, req.userId!);
  if (!deleted) { res.status(403).json({ message: 'Forbidden or not found' }); return; }
  res.status(204).send();
}

export async function listMyPosts(req: AuthRequest, res: Response) {
  const pagination = requirePagination(res, req.query as Record<string, unknown>);
  if (!pagination) return;
  const posts = await listUserQAPosts(req.userId!, pagination);
  setPaginationHeaders(res, pagination);
  res.json(posts.map(p => ({ ...p, author: { nickname: '익명' } })));
}

export async function listMyAnswers(req: AuthRequest, res: Response) {
  const pagination = requirePagination(res, req.query as Record<string, unknown>);
  if (!pagination) return;
  const posts = await listLawyerAnswers(req.userId!, pagination);
  setPaginationHeaders(res, pagination);
  res.json(posts);
}

export async function createPost(req: AuthRequest, res: Response) {
  const parsed = validateQAPost(req.body);
  if ('error' in parsed) {
    res.status(400).json({ message: 'title, content, category are required' });
    return;
  }
  const { title, content, category, imageUrls } = parsed.data;
  const post = await createQAPost(req.userId!, title, content, category, imageUrls);
  createNotificationsForLawyers('new_question', '새로운 질문이 등록됐습니다!', title, post.id)
    .catch((error: unknown) => logger.error({
      event: 'notification_create_failed',
      refId: post.id,
      error: error instanceof Error ? error.message : String(error),
    }));
  res.status(201).json(post);
}

export async function scrapPost(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id, 'Invalid id');
  if (postId === null) return;
  const result = await toggleQAScrap(req.userId!, postId);
  res.json(result);
}

export async function getScrapStatus(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id, 'Invalid id');
  if (postId === null) return;
  const result = await getQAScrapStatus(req.userId!, postId);
  res.json(result);
}

export async function getMyQAScraps(req: AuthRequest, res: Response) {
  const posts = await getUserQAScraps(req.userId!);
  res.json(posts);
}

export async function createAnswer(req: AuthRequest, res: Response) {
  const postId = parseId(req.params.id);
  const parsed = validateQAAnswer(req.body);
  if (postId === null || 'error' in parsed) {
    res.status(400).json({ message: 'postId and content are required' });
    return;
  }
  const existing = await getQAPostAnswerState(postId);
  if (!existing) { res.status(404).json({ message: 'Post not found' }); return; }
  if (existing.answer) { res.status(409).json({ message: 'Already answered' }); return; }
  const answer = await createQAAnswer(postId, req.userId!, parsed.data.content);
  if (!answer) { res.status(403).json({ message: 'Lawyer role is required' }); return; }
  res.status(201).json(answer);
}
