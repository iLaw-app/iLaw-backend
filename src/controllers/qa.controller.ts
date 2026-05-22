import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { listQAPosts, listUserQAPosts, getQAPost, createQAPost, createQAAnswer, embedQAPost, searchQAPosts, listLawyerAnswers } from '../services/qa.service';
import { toggleQAScrap, getQAScrapStatus, getUserQAScraps } from '../services/scrap.service';
import { createNotificationsForLawyers } from '../services/notification.service';

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

export async function listPosts(_req: AuthRequest, res: Response) {
  const posts = await listQAPosts();
  res.json(posts.map(p => ({ ...p, author: { nickname: '익명' } })));
}

export async function getPost(req: AuthRequest, res: Response) {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
  const post = await getQAPost(id);
  if (!post) { res.status(404).json({ message: 'Not found' }); return; }
  res.json({ ...post, author: { nickname: '익명' } });
}

export async function listMyPosts(req: AuthRequest, res: Response) {
  const posts = await listUserQAPosts(req.userId!);
  res.json(posts.map(p => ({ ...p, author: { nickname: '익명' } })));
}

export async function listMyAnswers(req: AuthRequest, res: Response) {
  const posts = await listLawyerAnswers(req.userId!);
  res.json(posts);
}

export async function createPost(req: AuthRequest, res: Response) {
  const { title, content, category, imageUrls } = req.body as { title?: string; content?: string; category?: string; imageUrls?: string[] };
  if (!title?.trim() || !content?.trim() || !category?.trim()) {
    res.status(400).json({ message: 'title, content, category are required' });
    return;
  }
  const post = await createQAPost(req.userId!, title, content, category, imageUrls ?? []);
  createNotificationsForLawyers('new_question', '새로운 질문이 등록됐습니다!', title, post.id).catch(() => {});
  embedQAPost(post.id, `${title} ${content}`).catch(() => {});
  res.status(201).json(post);
}

export async function scrapPost(req: AuthRequest, res: Response) {
  const postId = parseInt(req.params.id as string);
  if (isNaN(postId)) { res.status(400).json({ message: 'Invalid id' }); return; }
  const result = await toggleQAScrap(req.userId!, postId);
  res.json(result);
}

export async function getScrapStatus(req: AuthRequest, res: Response) {
  const postId = parseInt(req.params.id as string);
  if (isNaN(postId)) { res.status(400).json({ message: 'Invalid id' }); return; }
  const result = await getQAScrapStatus(req.userId!, postId);
  res.json(result);
}

export async function getMyQAScraps(req: AuthRequest, res: Response) {
  const posts = await getUserQAScraps(req.userId!);
  res.json(posts);
}

export async function createAnswer(req: AuthRequest, res: Response) {
  const postId = parseInt(req.params.id as string);
  const { content } = req.body as { content?: string };
  if (isNaN(postId) || !content?.trim()) {
    res.status(400).json({ message: 'postId and content are required' });
    return;
  }
  const existing = await getQAPost(postId);
  if (!existing) { res.status(404).json({ message: 'Post not found' }); return; }
  if (existing.answer) { res.status(409).json({ message: 'Already answered' }); return; }
  const answer = await createQAAnswer(postId, req.userId!, content);
  res.status(201).json(answer);
}
