import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  aiChatHistory: { findMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return { chat: { completions: { create: vi.fn() } } };
  }),
}));
vi.mock('../src/prisma/client', () => ({ default: prismaMock }));

import { pruneAiChatHistory } from '../src/services/ai.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.aiChatHistory.deleteMany.mockResolvedValue({ count: 0 });
});

describe('pruneAiChatHistory', () => {
  it('최신 keep개를 남기고 나머지를 삭제한다', async () => {
    prismaMock.aiChatHistory.findMany.mockResolvedValue([
      { id: 30 }, { id: 29 }, { id: 28 }, { id: 27 }, { id: 26 },
    ]);

    await pruneAiChatHistory('user-1', 5);

    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, take: 5, orderBy: { createdAt: 'desc' } }),
    );
    expect(prismaMock.aiChatHistory.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { notIn: [30, 29, 28, 27, 26] } },
    });
  });

  it('저장된 이력이 keep개 이하면 아무것도 삭제하지 않는다', async () => {
    prismaMock.aiChatHistory.findMany.mockResolvedValue([{ id: 3 }, { id: 2 }, { id: 1 }]);

    await pruneAiChatHistory('user-1', 5);

    expect(prismaMock.aiChatHistory.deleteMany).not.toHaveBeenCalled();
  });
});
