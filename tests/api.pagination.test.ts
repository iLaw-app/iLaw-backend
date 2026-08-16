import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  qnAPost: { findMany: vi.fn() },
  qnAAnswer: { findMany: vi.fn() },
  notification: { findMany: vi.fn() },
  manualArticle: { findMany: vi.fn() },
  agency: { findMany: vi.fn() },
}));
vi.mock('../src/prisma/client', () => ({ default: prisma }));

import { listLawyerAnswers, listQAPosts, listUserQAPosts } from '../src/services/qa.service';
import { getUserNotifications } from '../src/services/notification.service';
import { getAgencies, getArticlesByCategory } from '../src/services/manual.service';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.qnAPost.findMany.mockResolvedValue([]);
  prisma.qnAAnswer.findMany.mockResolvedValue([]);
  prisma.notification.findMany.mockResolvedValue([]);
  prisma.manualArticle.findMany.mockResolvedValue([]);
  prisma.agency.findMany.mockResolvedValue([]);
});

describe('Prisma 목록 pagination', () => {
  it('Q&A 전체 목록에 skip/take와 안정적인 정렬을 적용한다', async () => {
    await listQAPosts('me', { page: 3, limit: 20 });
    expect(prisma.qnAPost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 40,
      take: 20,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('내 질문 목록에 skip/take와 안정적인 정렬을 적용한다', async () => {
    await listUserQAPosts('me', { page: 2, limit: 10 });
    expect(prisma.qnAPost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10,
      take: 10,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('내 답변 목록에 skip/take와 안정적인 정렬을 적용한다', async () => {
    await listLawyerAnswers('lawyer', { page: 4, limit: 5 });
    expect(prisma.qnAAnswer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 15,
      take: 5,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('notification 목록의 기존 50 고정을 요청 pagination으로 대체하고 안정적으로 정렬한다', async () => {
    await getUserNotifications('me', { page: 2, limit: 30 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 30,
      take: 30,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('manual article과 agency 목록에도 skip/take와 안정적인 정렬을 적용한다', async () => {
    await getArticlesByCategory('labor', { page: 2, limit: 20 });
    expect(prisma.manualArticle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    }));

    await getAgencies('labor', '서울', { page: 3, limit: 10 });
    expect(prisma.agency.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 10,
      orderBy: [{ region: 'asc' }, { id: 'asc' }],
    }));
  });
});
