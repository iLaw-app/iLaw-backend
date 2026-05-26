import prisma from '../prisma/client';

export async function toggleArticleScrap(userId: string, articleId: number): Promise<{ scrapped: boolean }> {
  const existing = await prisma.articleScrap.findUnique({
    where: { userId_articleId: { userId, articleId } },
  });
  if (existing) {
    await prisma.articleScrap.delete({ where: { id: existing.id } });
    return { scrapped: false };
  }
  await prisma.articleScrap.create({ data: { userId, articleId } });
  return { scrapped: true };
}

export async function getArticleScrapStatus(userId: string, articleId: number) {
  const existing = await prisma.articleScrap.findUnique({
    where: { userId_articleId: { userId, articleId } },
  });
  const count = await prisma.articleScrap.count({ where: { articleId } });
  return { scrapped: !!existing, count };
}

export async function getUserScraps(userId: string) {
  const scraps = await prisma.articleScrap.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      article: {
        select: {
          id: true,
          question: true,
          summary: true,
          category: { select: { name: true, slug: true } },
          _count: { select: { scraps: true } },
        },
      },
    },
  });
  return scraps.map(({ article: { _count, ...a } }: any) => ({ ...a, scrapCount: _count.scraps }));
}

export async function toggleQAScrap(userId: string, postId: number): Promise<{ scrapped: boolean }> {
  const existing = await prisma.qnAScrap.findUnique({
    where: { userId_postId: { userId, postId } },
  });
  if (existing) {
    await prisma.qnAScrap.delete({ where: { id: existing.id } });
    return { scrapped: false };
  }
  await prisma.qnAScrap.create({ data: { userId, postId } });
  return { scrapped: true };
}

export async function getQAScrapStatus(userId: string, postId: number) {
  const existing = await prisma.qnAScrap.findUnique({
    where: { userId_postId: { userId, postId } },
  });
  const count = await prisma.qnAScrap.count({ where: { postId } });
  return { scrapped: !!existing, count };
}

export async function getUserQAScraps(userId: string) {
  const scraps = await prisma.qnAScrap.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      post: {
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          status: true,
          createdAt: true,
          author: { select: { nickname: true } },
          _count: { select: { scraps: true } },
        },
      },
    },
  });
  return scraps.map(({ post: { _count, ...p } }: any) => ({ ...p, scrapCount: _count.scraps, author: { nickname: '익명' } }));
}
