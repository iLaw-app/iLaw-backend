import prisma from '../prisma/client';
import { checkProfanityFields } from './profanity';
import { moderateAndBlind } from './moderation.service';
import { HIDDEN_POST_STATUSES } from './community-shared';
import { buildCommentTree, buildLabelMapFromComments } from './community-presenter';

export async function listComments(postId: number, userId?: string) {
  const [post, comments] = await Promise.all([
    prisma.communityPost.findUnique({ where: { id: postId }, select: { authorId: true, status: true } }),
    prisma.communityComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, nickname: true } },
        likes: userId ? { where: { userId }, select: { userId: true } } : false,
        _count: { select: { likes: true } },
      },
    }),
  ]);

  if (!post || HIDDEN_POST_STATUSES.includes(post.status)) return [];

  const labels = buildLabelMapFromComments(comments, post.authorId);
  return buildCommentTree(comments, labels, post.authorId, userId);
}

export async function createComment(postId: number, userId: string, content: string, parentId?: number) {
  // 1차 필터: 로컬 금칙어 사전에 걸리면 작성 자체를 거부한다.
  const profanity = checkProfanityFields({ content });
  if (profanity) return { error: 'profanity_blocked' as const, details: profanity };

  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true, authorId: true, status: true } });
  if (!post || HIDDEN_POST_STATUSES.includes(post.status)) return { error: 'not_found' as const };
  if (parentId) {
    const parent = await prisma.communityComment.findUnique({
      where: { id: parentId },
      select: { id: true, postId: true, parentId: true },
    });
    if (!parent || parent.postId !== postId) return { error: 'parent_not_found' as const };
    if (parent.parentId) return { error: 'nested_reply' as const };
  }

  const comment = await prisma.communityComment.create({
    data: { postId, authorId: userId, content, parentId },
  });

  // 2차 필터: 게시 후 백그라운드 검열(클린봇 방식). 응답을 막지 않는다.
  void moderateAndBlind({ kind: 'comment', id: comment.id, text: content, authorId: userId });

  // 방금 생성한 댓글까지 포함해 작성자 등장 순서로 번호를 다시 계산
  const allComments = await prisma.communityComment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    select: { author: { select: { id: true } }, createdAt: true },
  });
  const labels = buildLabelMapFromComments(allComments, post.authorId);
  const isPostAuthor = !!post.authorId && userId === post.authorId;
  const nickname = isPostAuthor ? '익명(글쓴이)' : `익명${labels.get(userId) ?? 1}`;

  return {
    data: {
      id: comment.id,
      nickname,
      createdAt: comment.createdAt,
      content: comment.content,
      likes: 0,
      liked: false,
      parentId: comment.parentId,
      isAuthor: true,
      isPostAuthor,
      replies: [],
    },
  };
}

export async function deleteComment(commentId: number, userId: string) {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    select: { authorId: true, status: true },
  });
  if (!comment || comment.status === 'deleted' || comment.status === 'removed') return { error: 'not_found' as const };
  if (comment.authorId !== userId) return { error: 'forbidden' as const };

  await prisma.communityComment.update({ where: { id: commentId }, data: { status: 'deleted' } });
  return { data: true };
}