import { Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { listQnAPosts, listUserQnAPosts, getQnAPost, createQnAPost, createQnAAnswer } from '../services/qna.service';
import { toggleQnAScrap, getQnAScrapStatus, getUserQnAScraps } from '../services/scrap.service';
import prisma from '../prisma/client';

export async function listPosts(_req: AuthRequest, res: Response) {
  const posts = await listQnAPosts();
  res.json(posts);
}

export async function getPost(req: AuthRequest, res: Response) {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
  const post = await getQnAPost(id);
  if (!post) { res.status(404).json({ message: 'Not found' }); return; }
  res.json(post);
}

export async function listMyPosts(req: AuthRequest, res: Response) {
  const posts = await listUserQnAPosts(req.userId!);
  res.json(posts);
}

export async function createPost(req: AuthRequest, res: Response) {
  const { title, content, category, imageUrls } = req.body as { title?: string; content?: string; category?: string; imageUrls?: string[] };
  if (!title?.trim() || !content?.trim() || !category?.trim()) {
    res.status(400).json({ message: 'title, content, category are required' });
    return;
  }
  const post = await createQnAPost(req.userId!, title, content, category, imageUrls ?? []);
  res.status(201).json(post);
}

export async function scrapPost(req: AuthRequest, res: Response) {
  const postId = parseInt(req.params.id as string);
  if (isNaN(postId)) { res.status(400).json({ message: 'Invalid id' }); return; }
  const result = await toggleQnAScrap(req.userId!, postId);
  res.json(result);
}

export async function getScrapStatus(req: AuthRequest, res: Response) {
  const postId = parseInt(req.params.id as string);
  if (isNaN(postId)) { res.status(400).json({ message: 'Invalid id' }); return; }
  const result = await getQnAScrapStatus(req.userId!, postId);
  res.json(result);
}

export async function getMyQnAScraps(req: AuthRequest, res: Response) {
  const posts = await getUserQnAScraps(req.userId!);
  res.json(posts);
}

export async function createAnswer(req: AuthRequest, res: Response) {
  const postId = parseInt(req.params.id as string);
  const { content } = req.body as { content?: string };
  if (isNaN(postId) || !content?.trim()) {
    res.status(400).json({ message: 'postId and content are required' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true } });
  if (user?.role !== 'lawyer') {
    res.status(403).json({ message: 'Only lawyers can answer' });
    return;
  }
  const existing = await getQnAPost(postId);
  if (!existing) { res.status(404).json({ message: 'Post not found' }); return; }
  if (existing.answer) { res.status(409).json({ message: 'Already answered' }); return; }
  const answer = await createQnAAnswer(postId, req.userId!, content);
  res.status(201).json(answer);
}
