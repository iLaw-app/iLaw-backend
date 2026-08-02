import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { requireId, sendServiceError } from '../utils/http';
import * as communityService from '../services/community.service';

const COMMENT_NOT_FOUND = { not_found: { status: 404, message: '댓글을 찾을 수 없습니다.' } };

export async function searchPosts(req: Request, res: Response) {
  const q = req.query.q as string;
  if (!q?.trim()) { res.json([]); return; }
  const debug = req.query.debug === 'true';
  const results = await communityService.searchCommunityPosts(q.trim(), debug);
  res.json(results);
}

export async function listPosts(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20')) || 20));
  const result = await communityService.listPosts(page, limit);
  res.json(result);
}

export async function getPost(req: Request, res: Response) {
  const id = requireId(res, req.params.id);
  if (id === null) return;

  const userId = (req as AuthRequest).userId;
  const post = await communityService.getPost(id, userId);
  if (!post) { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  res.json(post);
}

export async function createPost(req: AuthRequest, res: Response) {
  const { title, content, poll, imageUrls } = req.body;
  if (!title?.trim()) { res.status(400).json({ message: '제목을 입력해주세요.' }); return; }

  const post = await communityService.createPost(req.userId!, { title, content, poll, imageUrls });
  if (post.error) { sendServiceError(res, post.error); return; }
  res.status(201).json(post.data);
}

export async function updatePost(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id);
  if (id === null) return;

  const { title, content, poll, imageUrls } = req.body;
  const result = await communityService.updatePost(id, req.userId!, { title, content, poll, imageUrls });
  if (result.error) { sendServiceError(res, result.error); return; }
  res.json(result.data);
}

export async function deletePost(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id);
  if (id === null) return;

  const result = await communityService.deletePost(id, req.userId!);
  if (result.error) { sendServiceError(res, result.error); return; }
  res.status(204).send();
}

export async function toggleLike(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id);
  if (postId === null) return;

  const result = await communityService.toggleLike(postId, req.userId!);
  if (result.error) { sendServiceError(res, result.error); return; }
  res.json(result.data);
}

export async function toggleBookmark(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id);
  if (postId === null) return;

  const result = await communityService.toggleBookmark(postId, req.userId!);
  if (result.error) { sendServiceError(res, result.error); return; }
  res.json(result.data);
}

export async function votePoll(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id);
  if (postId === null) return;

  const { optionIndex } = req.body as { optionIndex?: number };
  const result = await communityService.votePoll(postId, req.userId!, Number(optionIndex));
  if (result.error) { sendServiceError(res, result.error); return; }
  res.json(result.data);
}

export async function listComments(req: Request, res: Response) {
  const postId = requireId(res, req.params.id);
  if (postId === null) return;

  const comments = await communityService.listComments(postId, (req as AuthRequest).userId);
  res.json(comments);
}

export async function createComment(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id);
  if (postId === null) return;

  const { content, parentId } = req.body as { content?: string; parentId?: number };
  if (!content?.trim()) { res.status(400).json({ message: '댓글 내용을 입력해주세요.' }); return; }

  const result = await communityService.createComment(postId, req.userId!, content, parentId);
  if (result.error) { sendServiceError(res, result.error); return; }
  res.status(201).json(result.data);
}

export async function deleteComment(req: AuthRequest, res: Response) {
  const commentId = requireId(res, req.params.commentId);
  if (commentId === null) return;

  const result = await communityService.deleteComment(commentId, req.userId!);
  if (result.error) { sendServiceError(res, result.error, COMMENT_NOT_FOUND); return; }
  res.status(204).send();
}

export async function getMyBookmarks(req: AuthRequest, res: Response) {
  const posts = await communityService.getMyBookmarks(req.userId!);
  res.json(posts);
}

export async function toggleCommentLike(req: AuthRequest, res: Response) {
  const commentId = requireId(res, req.params.commentId);
  if (commentId === null) return;

  const result = await communityService.toggleCommentLike(commentId, req.userId!);
  if (result.error) { sendServiceError(res, result.error, COMMENT_NOT_FOUND); return; }
  res.json(result.data);
}

export async function reportPost(req: AuthRequest, res: Response) {
  const postId = requireId(res, req.params.id);
  if (postId === null) return;

  const { reason } = req.body as { reason?: string };
  const result = await communityService.reportPost(postId, req.userId!, reason);
  if (result.error) { sendServiceError(res, result.error); return; }
  res.status(201).json(result.data);
}

export async function reportComment(req: AuthRequest, res: Response) {
  const commentId = requireId(res, req.params.commentId);
  if (commentId === null) return;

  const { reason } = req.body as { reason?: string };
  const result = await communityService.reportComment(commentId, req.userId!, reason);
  if (result.error) { sendServiceError(res, result.error, COMMENT_NOT_FOUND); return; }
  res.status(201).json(result.data);
}
