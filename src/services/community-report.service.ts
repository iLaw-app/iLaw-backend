import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { createNotification } from './notification.service';

const REPORT_DELETE_THRESHOLD = 3;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function reportComment(commentId: number, userId: string, reason?: string) {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    select: { authorId: true, status: true },
  });
  if (!comment || comment.status === 'deleted' || comment.status === 'removed') return { error: 'not_found' as const };
  if (comment.authorId && comment.authorId === userId) return { error: 'cannot_report_self' as const };

  try {
    await prisma.communityCommentReport.create({ data: { commentId, reporterId: userId, reason } });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'already_reported' as const };
    throw error;
  }

  // unique(commentId, reporterId) 제약이 있으므로 신고 건수 = 서로 다른 신고자 수.
  const count = await prisma.communityCommentReport.count({ where: { commentId } });
  let deleted = false;
  if (count >= REPORT_DELETE_THRESHOLD) {
    const updated = await prisma.communityComment.updateMany({
      where: { id: commentId, status: { notIn: ['deleted', 'removed'] } },
      data: { status: 'removed' },
    });
    if (updated.count > 0) {
      deleted = true;
      if (comment.authorId) {
        await createNotification(
          comment.authorId,
          'community_removed',
          '댓글이 삭제되었습니다',
          '신고가 누적되어 작성하신 댓글이 삭제되었습니다.',
          commentId,
        );
      }
    }
  }

  return { data: { reported: true, count, deleted } };
}

export async function reportPost(postId: number, userId: string, reason?: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { authorId: true, status: true },
  });
  if (!post || post.status === 'deleted' || post.status === 'removed') return { error: 'not_found' as const };
  if (post.authorId && post.authorId === userId) return { error: 'cannot_report_self' as const };

  try {
    await prisma.communityPostReport.create({ data: { postId, reporterId: userId, reason } });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'already_reported' as const };
    throw error;
  }

  const count = await prisma.communityPostReport.count({ where: { postId } });
  let deleted = false;
  if (count >= REPORT_DELETE_THRESHOLD) {
    const updated = await prisma.communityPost.updateMany({
      where: { id: postId, status: { notIn: ['deleted', 'removed'] } },
      data: { status: 'removed' },
    });
    if (updated.count > 0) {
      deleted = true;
      if (post.authorId) {
        await createNotification(
          post.authorId,
          'community_removed',
          '게시글이 삭제되었습니다',
          '신고가 누적되어 작성하신 게시글이 삭제되었습니다.',
          postId,
        );
      }
    }
  }

  return { data: { reported: true, count, deleted } };
}