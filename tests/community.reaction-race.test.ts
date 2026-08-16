import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  communityPost: { findUnique: vi.fn() },
  communityComment: { findUnique: vi.fn() },
  communityLike: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
  communityBookmark: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
  communityCommentLike: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
}));

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));

import { toggleBookmark, toggleCommentLike, toggleLike } from '../src/services/community.service';

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.communityPost.findUnique.mockResolvedValue({ id: 1 });
  prismaMock.communityComment.findUnique.mockResolvedValue({ id: 2 });
  prismaMock.communityLike.findUnique.mockResolvedValue(null);
  prismaMock.communityBookmark.findUnique.mockResolvedValue(null);
  prismaMock.communityCommentLike.findUnique.mockResolvedValue(null);
  prismaMock.communityLike.count.mockResolvedValue(1);
  prismaMock.communityBookmark.count.mockResolvedValue(1);
  prismaMock.communityCommentLike.count.mockResolvedValue(1);
});

describe('reaction 생성 unique 경합', () => {
  it('동시 좋아요 생성 뒤 compound key를 재조회한다', async () => {
    prismaMock.communityLike.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'user-1', postId: 1 });
    prismaMock.communityLike.create.mockRejectedValue(knownError('P2002'));

    await expect(toggleLike(1, 'user-1')).resolves.toEqual({ data: { liked: true, count: 1 } });
    expect(prismaMock.communityLike.findUnique).toHaveBeenCalledTimes(2);
  });

  it('동시 북마크 생성 뒤 compound key를 재조회한다', async () => {
    prismaMock.communityBookmark.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'user-1', postId: 1 });
    prismaMock.communityBookmark.create.mockRejectedValue(knownError('P2002'));

    await expect(toggleBookmark(1, 'user-1')).resolves.toEqual({ data: { bookmarked: true, count: 1 } });
    expect(prismaMock.communityBookmark.findUnique).toHaveBeenCalledTimes(2);
  });

  it('동시 댓글 좋아요 생성 뒤 compound key를 재조회한다', async () => {
    prismaMock.communityCommentLike.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'user-1', commentId: 2 });
    prismaMock.communityCommentLike.create.mockRejectedValue(knownError('P2002'));

    await expect(toggleCommentLike(2, 'user-1')).resolves.toEqual({ data: { liked: true, count: 1 } });
    expect(prismaMock.communityCommentLike.findUnique).toHaveBeenCalledTimes(2);
  });

  it('생성 경합 직후 행이 사라졌으면 실제 해제 상태를 반환한다', async () => {
    prismaMock.communityLike.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMock.communityLike.create.mockRejectedValue(knownError('P2002'));
    prismaMock.communityLike.count.mockResolvedValue(0);

    await expect(toggleLike(1, 'user-1')).resolves.toEqual({ data: { liked: false, count: 0 } });
  });

  it('unique 이외 DB 오류는 숨기지 않는다', async () => {
    const error = new Error('database unavailable');
    prismaMock.communityLike.create.mockRejectedValue(error);
    await expect(toggleLike(1, 'user-1')).rejects.toBe(error);
  });
});

describe('reaction 삭제 경합', () => {
  it('동시 좋아요 삭제 뒤 실제 해제 상태와 count를 반환한다', async () => {
    prismaMock.communityLike.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', postId: 1 })
      .mockResolvedValueOnce(null);
    prismaMock.communityLike.delete.mockRejectedValue(knownError('P2025'));
    prismaMock.communityLike.count.mockResolvedValue(0);

    await expect(toggleLike(1, 'user-1')).resolves.toEqual({ data: { liked: false, count: 0 } });
    expect(prismaMock.communityLike.findUnique).toHaveBeenCalledTimes(2);
  });

  it('동시 북마크 삭제 뒤 실제 해제 상태와 count를 반환한다', async () => {
    prismaMock.communityBookmark.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', postId: 1 })
      .mockResolvedValueOnce(null);
    prismaMock.communityBookmark.delete.mockRejectedValue(knownError('P2025'));
    prismaMock.communityBookmark.count.mockResolvedValue(0);

    await expect(toggleBookmark(1, 'user-1')).resolves.toEqual({ data: { bookmarked: false, count: 0 } });
    expect(prismaMock.communityBookmark.findUnique).toHaveBeenCalledTimes(2);
  });

  it('삭제 경합 직후 행이 재생성됐으면 실제 설정 상태를 반환한다', async () => {
    prismaMock.communityBookmark.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', postId: 1 })
      .mockResolvedValueOnce({ userId: 'user-1', postId: 1 });
    prismaMock.communityBookmark.delete.mockRejectedValue(knownError('P2025'));
    prismaMock.communityBookmark.count.mockResolvedValue(1);

    await expect(toggleBookmark(1, 'user-1')).resolves.toEqual({ data: { bookmarked: true, count: 1 } });
  });

  it('동시 댓글 좋아요 삭제 뒤 실제 해제 상태와 count를 반환한다', async () => {
    prismaMock.communityCommentLike.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', commentId: 2 })
      .mockResolvedValueOnce(null);
    prismaMock.communityCommentLike.delete.mockRejectedValue(knownError('P2025'));
    prismaMock.communityCommentLike.count.mockResolvedValue(0);

    await expect(toggleCommentLike(2, 'user-1')).resolves.toEqual({ data: { liked: false, count: 0 } });
    expect(prismaMock.communityCommentLike.findUnique).toHaveBeenCalledTimes(2);
  });
});
