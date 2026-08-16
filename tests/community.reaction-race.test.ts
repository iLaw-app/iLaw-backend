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

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
  it('동시 좋아요에서 다른 요청이 먼저 생성해도 성공 상태를 반환한다', async () => {
    prismaMock.communityLike.create.mockRejectedValue(uniqueViolation());
    await expect(toggleLike(1, 'user-1')).resolves.toEqual({ data: { liked: true, count: 1 } });
  });

  it('동시 북마크에서 다른 요청이 먼저 생성해도 성공 상태를 반환한다', async () => {
    prismaMock.communityBookmark.create.mockRejectedValue(uniqueViolation());
    await expect(toggleBookmark(1, 'user-1')).resolves.toEqual({ data: { bookmarked: true, count: 1 } });
  });

  it('동시 댓글 좋아요에서 다른 요청이 먼저 생성해도 성공 상태를 반환한다', async () => {
    prismaMock.communityCommentLike.create.mockRejectedValue(uniqueViolation());
    await expect(toggleCommentLike(2, 'user-1')).resolves.toEqual({ data: { liked: true, count: 1 } });
  });

  it('unique 이외 DB 오류는 숨기지 않는다', async () => {
    const error = new Error('database unavailable');
    prismaMock.communityLike.create.mockRejectedValue(error);
    await expect(toggleLike(1, 'user-1')).rejects.toBe(error);
  });
});
