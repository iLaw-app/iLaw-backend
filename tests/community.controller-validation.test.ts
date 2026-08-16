import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMock = vi.hoisted(() => ({
  createPost: vi.fn(),
  updatePost: vi.fn(),
  createComment: vi.fn(),
  votePoll: vi.fn(),
  searchCommunityPosts: vi.fn(),
}));

vi.mock('../src/services/community.service', () => serviceMock);

import * as controller from '../src/controllers/community.controller';

function response() {
  const json = vi.fn();
  const send = vi.fn();
  const status = vi.fn(() => ({ json, send }));
  return { res: { status, json, send } as never, status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('커뮤니티 컨트롤러 입력 경계', () => {
  it('문자열이 아닌 제목을 400으로 거부하고 서비스에 전달하지 않는다', async () => {
    const { res, status } = response();
    await controller.createPost({ userId: 'user-1', body: { title: 123 } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(serviceMock.createPost).not.toHaveBeenCalled();
  });

  it('수정 본문 길이 상한을 넘으면 400으로 거부한다', async () => {
    const { res, status } = response();
    await controller.updatePost({ params: { id: '1' }, userId: 'user-1', body: { content: 'x'.repeat(10_001) } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(serviceMock.updatePost).not.toHaveBeenCalled();
  });

  it('문자열이 아닌 댓글을 400으로 거부한다', async () => {
    const { res, status } = response();
    await controller.createComment({ params: { id: '1' }, userId: 'user-1', body: { content: {} } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(serviceMock.createComment).not.toHaveBeenCalled();
  });

  it('배열 검색어를 400으로 거부한다', async () => {
    const { res, status } = response();
    await controller.searchPosts({ query: { q: ['검색어'] } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(serviceMock.searchCommunityPosts).not.toHaveBeenCalled();
  });

  it('문자열 투표 인덱스를 숫자로 강제 변환하지 않고 400으로 거부한다', async () => {
    const { res, status } = response();
    await controller.votePoll({ params: { id: '1' }, userId: 'user-1', body: { optionIndex: '0' } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(serviceMock.votePoll).not.toHaveBeenCalled();
  });
});
