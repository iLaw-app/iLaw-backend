import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import * as communityService from '../services/community.service';

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
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const userId = (req as AuthRequest).userId;
  const post = await communityService.getPost(id, userId);
  if (!post) { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  res.json(post);
}

export async function createPost(req: AuthRequest, res: Response) {
  const { title, content, poll, imageUrls } = req.body;
  if (!title?.trim()) { res.status(400).json({ message: '제목을 입력해주세요.' }); return; }

  const post = await communityService.createPost(req.userId!, { title, content, poll, imageUrls });
  if ('error' in post) {
    res.status(400).json({ message: '투표 선택지를 확인해주세요.' });
    return;
  }
  res.status(201).json(post.data);
}

export async function updatePost(req: AuthRequest, res: Response) {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const { title, content, poll, imageUrls } = req.body;
  const result = await communityService.updatePost(id, req.userId!, { title, content, poll, imageUrls });
  if ('error' in result) {
    if (result.error === 'not_found') { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
    if (result.error === 'forbidden') { res.status(403).json({ message: '권한이 없습니다.' }); return; }
    if (result.error === 'poll_locked') { res.status(409).json({ message: '투표가 시작된 후에는 선택지를 변경할 수 없습니다.' }); return; }
    res.status(400).json({ message: '투표 선택지를 확인해주세요.' });
    return;
  }
  res.json(result.data);
}

export async function deletePost(req: AuthRequest, res: Response) {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const result = await communityService.deletePost(id, req.userId!);
  if (result.error === 'not_found') { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  if (result.error === 'forbidden') { res.status(403).json({ message: '권한이 없습니다.' }); return; }
  res.status(204).send();
}

export async function toggleLike(req: AuthRequest, res: Response) {
  const postId = parseInt(String(req.params.id));
  if (isNaN(postId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const result = await communityService.toggleLike(postId, req.userId!);
  if (result.error === 'not_found') { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  res.json(result.data);
}

export async function toggleBookmark(req: AuthRequest, res: Response) {
  const postId = parseInt(String(req.params.id));
  if (isNaN(postId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const result = await communityService.toggleBookmark(postId, req.userId!);
  if (result.error === 'not_found') { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  res.json(result.data);
}

export async function votePoll(req: AuthRequest, res: Response) {
  const postId = parseInt(String(req.params.id));
  if (isNaN(postId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const { optionIndex } = req.body as { optionIndex?: number };
  const result = await communityService.votePoll(postId, req.userId!, Number(optionIndex));
  if (result.error === 'not_found') { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  if (result.error === 'no_poll') { res.status(400).json({ message: '투표가 없는 게시글입니다.' }); return; }
  if (result.error === 'invalid_option') { res.status(400).json({ message: '잘못된 선택지입니다.' }); return; }
  res.json(result.data);
}

export async function listComments(req: Request, res: Response) {
  const postId = parseInt(String(req.params.id));
  if (isNaN(postId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const comments = await communityService.listComments(postId, (req as AuthRequest).userId);
  res.json(comments);
}

export async function createComment(req: AuthRequest, res: Response) {
  const postId = parseInt(String(req.params.id));
  if (isNaN(postId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const { content, parentId } = req.body as { content?: string; parentId?: number };
  if (!content?.trim()) { res.status(400).json({ message: '댓글 내용을 입력해주세요.' }); return; }

  const result = await communityService.createComment(postId, req.userId!, content, parentId);
  if (result.error === 'not_found') { res.status(404).json({ message: '게시글을 찾을 수 없습니다.' }); return; }
  if (result.error === 'parent_not_found') { res.status(404).json({ message: '원댓글을 찾을 수 없습니다.' }); return; }
  if (result.error === 'nested_reply') { res.status(400).json({ message: '답글에는 다시 답글을 달 수 없습니다.' }); return; }
  res.status(201).json(result.data);
}

export async function deleteComment(req: AuthRequest, res: Response) {
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(commentId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const result = await communityService.deleteComment(commentId, req.userId!);
  if (result.error === 'not_found') { res.status(404).json({ message: '댓글을 찾을 수 없습니다.' }); return; }
  if (result.error === 'forbidden') { res.status(403).json({ message: '권한이 없습니다.' }); return; }
  res.status(204).send();
}

export async function getMyBookmarks(req: AuthRequest, res: Response) {
  const posts = await communityService.getMyBookmarks(req.userId!);
  res.json(posts);
}

export async function toggleCommentLike(req: AuthRequest, res: Response) {
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(commentId)) { res.status(400).json({ message: '잘못된 ID입니다.' }); return; }

  const result = await communityService.toggleCommentLike(commentId, req.userId!);
  if (result.error === 'not_found') { res.status(404).json({ message: '댓글을 찾을 수 없습니다.' }); return; }
  res.json(result.data);
}
