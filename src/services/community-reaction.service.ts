import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { ANONYMOUS_POST_AUTHOR, UNCOUNTED_COMMENT_STATUSES } from './community-shared';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function toggleLike(postId: number, userId: string) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: 'not_found' as const };

  const exists = await prisma.communityLike.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (exists) {
    await prisma.communityLike.delete({ where: { userId_postId: { userId, postId } } });
    const count = await prisma.communityLike.count({ where: { postId } });
    return { data: { liked: false, count } };
  } else {
    try {
      await prisma.communityLike.create({ data: { userId, postId } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const count = await prisma.communityLike.count({ where: { postId } });
    return { data: { liked: true, count } };
  }
}

export async function toggleBookmark(postId: number, userId: string) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: 'not_found' as const };

  const exists = await prisma.communityBookmark.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (exists) {
    await prisma.communityBookmark.delete({ where: { userId_postId: { userId, postId } } });
    const count = await prisma.communityBookmark.count({ where: { postId } });
    return { data: { bookmarked: false, count } };
  }

  try {
    await prisma.communityBookmark.create({ data: { userId, postId } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const count = await prisma.communityBookmark.count({ where: { postId } });
  return { data: { bookmarked: true, count } };
}

export async function getMyBookmarks(userId: string) {
  const bookmarks = await prisma.communityBookmark.findMany({
    where: { userId, post: { status: 'visible' } },
    orderBy: { createdAt: 'desc' },
    include: {
      post: {
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          updatedAt: true,
          imageUrls: true,
          _count: {
            select: {
              likes: true,
              bookmarks: true,
              comments: { where: { status: { notIn: UNCOUNTED_COMMENT_STATUSES } } },
            },
          },
        },
      },
    },
  });

  return bookmarks.map(({ post }) => ({
    id: post.id,
    nickname: ANONYMOUS_POST_AUTHOR,
    title: post.title,
    content: post.content,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    imageUrls: post.imageUrls,
    likes: post._count.likes,
    bookmarks: post._count.bookmarks,
    comments: post._count.comments,
  }));
}

// 목록의 작성자는 전부 '익명'으로 가려지므로 클라이언트가 목록만 보고 자기 글을
// 골라낼 수 없다. 글마다 상세를 조회해 isAuthor로 판별하는 N+1을 없애기 위한 엔드포인트.
// 응답 형태는 listPosts의 posts 항목과 동일하다.

export async function toggleCommentLike(commentId: number, userId: string) {
  const comment = await prisma.communityComment.findUnique({ where: { id: commentId }, select: { id: true } });
  if (!comment) return { error: 'not_found' as const };

  const exists = await prisma.communityCommentLike.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });

  if (exists) {
    await prisma.communityCommentLike.delete({ where: { userId_commentId: { userId, commentId } } });
    const count = await prisma.communityCommentLike.count({ where: { commentId } });
    return { data: { liked: false, count } };
  }

  try {
    await prisma.communityCommentLike.create({ data: { userId, commentId } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const count = await prisma.communityCommentLike.count({ where: { commentId } });
  return { data: { liked: true, count } };
}
