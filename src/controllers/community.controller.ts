import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import { requireId, sendServiceError, serviceErrorDetails } from '../utils/http';
import * as communityService from '../services/community.service';
import {
  validateCommentInput,
  validateCreatePostInput,
  validateSearchQuery,
  validateUpdatePostInput,
  validateVoteInput,
} from '../services/community-validation';

const COMMENT_NOT_FOUND = { not_found: { status: 404, message: '댓글을 찾을 수 없습니다.' } };

export async function searchPosts(req: Request, res: Response) {
  const parsed = validateSearchQuery(req.query.q ?? '');
  if ('error' in parsed) { sendServiceError(res, parsed.error); return; }
  if (!parsed.data.query) { res.json([]); return; }
  const debug = req.query.debug === 'true';
  const results = await communityService.searchCommunityPosts(parsed.data.query, debug);
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
  const parsed = validateCreatePostInput(req.body);
  if ('error' in parsed) { sendServiceError(res, parsed.error); return; }

  const post = await communityService.createPost(req.userId!, parsed.data);
  if (post.error) { sendServiceError(res, post.error, {}, serviceErrorDetails(post)); return; }
  res.status(201).json(post.data);
}

export async function updatePost(req: AuthRequest, res: Response) {
  const id = requireId(res, req.params.id);
  if (id === null) return;

  const parsed = validateUpdatePostInput(req.body);
  if ('error' in parsed) { sendServiceError(res, parsed.error); return; }
  const result = await communityService.updatePost(id, req.userId!, parsed.data);
  if (result.error) { sendServiceError(res, result.error, {}, serviceErrorDetails(result)); return; }
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

  const parsed = validateVoteInput(req.body);
  if ('error' in parsed) { sendServiceError(res, parsed.error); return; }
  const result = await communityService.votePoll(postId, req.userId!, parsed.data.optionIndex);
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

  const parsed = validateCommentInput(req.body);
  if ('error' in parsed) { sendServiceError(res, parsed.error); return; }

  const result = await communityService.createComment(
    postId,
    req.userId!,
    parsed.data.content,
    parsed.data.parentId,
  );
  if (result.error) { sendServiceError(res, result.error, {}, serviceErrorDetails(result)); return; }
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

export async function getMyPosts(req: AuthRequest, res: Response) {
  const posts = await communityService.getMyPosts(req.userId!);
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
