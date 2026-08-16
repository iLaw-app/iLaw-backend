import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  communityPost: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  communityPollVote: {
    findUnique: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    upsert: vi.fn(),
  },
  communityLike: { findUnique: vi.fn() },
  communityBookmark: { findUnique: vi.fn() },
}));

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));

import * as communityController from '../src/controllers/community.controller';
import * as communityService from '../src/services/community.service';

const storedPoll = {
  options: [
    { label: '찬성', votes: 999 },
    { label: '반대', votes: 777 },
  ],
};

function postRow() {
  return {
    id: 1,
    authorId: 'author-1',
    title: '투표',
    content: null,
    poll: storedPoll,
    imageUrls: [],
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    author: { nickname: '가려질 이름' },
    comments: [],
    _count: { likes: 0, bookmarks: 0, comments: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (operation: (tx: typeof prismaMock) => unknown) => operation(prismaMock));
  prismaMock.communityPost.findUnique.mockResolvedValue(postRow());
  prismaMock.communityPost.create.mockResolvedValue({
    id: 1,
    title: '투표',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  prismaMock.communityPost.update.mockResolvedValue(postRow());
  prismaMock.communityPost.findMany.mockResolvedValue([postRow()]);
  prismaMock.communityPost.count.mockResolvedValue(1);
  prismaMock.communityPollVote.count.mockResolvedValue(0);
  prismaMock.communityPollVote.findUnique.mockResolvedValue(null);
  prismaMock.communityPollVote.upsert.mockResolvedValue({
    id: 1,
    userId: 'user-1',
    postId: 1,
    optionIndex: 0,
  });
  prismaMock.communityPollVote.groupBy.mockResolvedValue([
    { postId: 1, optionIndex: 0, _count: { _all: 2 } },
    { postId: 1, optionIndex: 1, _count: { _all: 1 } },
  ]);
  prismaMock.communityLike.findUnique.mockResolvedValue(null);
  prismaMock.communityBookmark.findUnique.mockResolvedValue(null);
});

describe('커뮤니티 투표 입력', () => {
  it('클라이언트가 지정한 votes를 폐기하고 label만 저장한다', async () => {
    const result = await communityService.createPost('author-1', {
      title: '투표',
      poll: { options: [{ label: '찬성', votes: 100 }, { label: '반대' }] },
    });

    expect(result).toHaveProperty('data');
    expect(prismaMock.communityPost.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        poll: { options: [{ label: '찬성' }, { label: '반대' }] },
      }),
    }));
  });

  it('HTTP 입력의 조작된 votes도 무시하고 생성한다', async () => {
    const status = vi.fn();
    const json = vi.fn();
    status.mockReturnValue({ json });

    await communityController.createPost(
      {
        userId: 'author-1',
        body: {
          title: '투표',
          poll: { options: [{ label: '찬성', votes: 100 }, { label: '반대' }] },
        },
      } as never,
      { status, json } as never,
    );

    expect(status).toHaveBeenCalledWith(201);
    expect(prismaMock.communityPost.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        poll: { options: [{ label: '찬성' }, { label: '반대' }] },
      }),
    }));
  });

  it('선택지 label만 저장하고 투표 카운터는 저장하지 않는다', async () => {
    await communityService.createPost('author-1', {
      title: '투표',
      poll: { options: [{ label: ' 찬성 ' }, { label: '반대' }] },
    });

    expect(prismaMock.communityPost.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        poll: { options: [{ label: '찬성' }, { label: '반대' }] },
      }),
    }));
  });
});

describe('투표 수의 단일 진실 공급원', () => {
  it('목록에서 과거 JSON 카운터를 무시하고 투표 행을 집계한다', async () => {
    const result = await communityService.listPosts(1, 20);

    expect(result.posts[0].poll).toEqual({
      options: [{ label: '찬성', votes: 2 }, { label: '반대', votes: 1 }],
      total: 3,
      votedOptionIndex: null,
    });
    expect(prismaMock.communityPollVote.groupBy).toHaveBeenCalledWith({
      by: ['postId', 'optionIndex'],
      where: { postId: { in: [1] } },
      _count: { _all: true },
    });
  });

  it('상세에서도 JSON 카운터 대신 투표 행과 내 선택을 반환한다', async () => {
    prismaMock.communityPollVote.findUnique.mockResolvedValue({ optionIndex: 1 });

    const result = await communityService.getPost(1, 'user-1');

    expect(result?.poll).toEqual({
      options: [{ label: '찬성', votes: 2 }, { label: '반대', votes: 1 }],
      total: 3,
      votedOptionIndex: 1,
    });
  });
});

describe('원자적 투표와 선택지 잠금', () => {
  it('compound unique upsert만 사용하고 CommunityPost 카운터를 수정하지 않는다', async () => {
    const result = await communityService.votePoll(1, 'user-1', 0);

    expect(prismaMock.communityPollVote.upsert).toHaveBeenCalledWith({
      where: { userId_postId: { userId: 'user-1', postId: 1 } },
      create: { userId: 'user-1', postId: 1, optionIndex: 0 },
      update: { optionIndex: 0 },
    });
    expect(prismaMock.communityPost.update).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { poll: {
      options: [{ label: '찬성', votes: 2 }, { label: '반대', votes: 1 }],
      total: 3,
      votedOptionIndex: 0,
    } } });
  });

  it('같은 사용자의 반복 투표와 선택 변경 모두 같은 행을 upsert한다', async () => {
    await communityService.votePoll(1, 'user-1', 0);
    await communityService.votePoll(1, 'user-1', 0);
    await communityService.votePoll(1, 'user-1', 1);

    expect(prismaMock.communityPollVote.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.communityPollVote.upsert.mock.calls.map(([args]) => args.update)).toEqual([
      { optionIndex: 0 },
      { optionIndex: 0 },
      { optionIndex: 1 },
    ]);
    expect(prismaMock.communityPost.update).not.toHaveBeenCalled();
  });

  it('투표가 시작된 뒤 선택지 변경을 poll_locked로 거부한다', async () => {
    prismaMock.communityPollVote.count.mockResolvedValue(1);

    const result = await communityService.updatePost(1, 'author-1', {
      poll: { options: [{ label: '유지' }, { label: '변경' }] },
    });

    expect(result).toEqual({ error: 'poll_locked' });
    expect(prismaMock.communityPost.update).not.toHaveBeenCalled();
  });

  it('투표 저장과 결과 집계를 Serializable 트랜잭션으로 보호한다', async () => {
    await communityService.votePoll(1, 'user-1', 0);

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('선택지 잠금 확인과 게시글 수정을 Serializable 트랜잭션으로 보호한다', async () => {
    await communityService.updatePost(1, 'author-1', {
      poll: { options: [{ label: '유지' }, { label: '변경' }] },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('컨트롤러가 poll_locked를 HTTP 409로 매핑한다', async () => {
    prismaMock.communityPollVote.count.mockResolvedValue(1);
    const status = vi.fn();
    const json = vi.fn();
    status.mockReturnValue({ json });

    await communityController.updatePost(
      {
        params: { id: '1' },
        userId: 'author-1',
        body: { poll: { options: [{ label: '유지' }, { label: '변경' }] } },
      } as never,
      { status, json } as never,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      message: '투표가 시작된 후에는 선택지를 변경할 수 없습니다.',
    });
  });
});
