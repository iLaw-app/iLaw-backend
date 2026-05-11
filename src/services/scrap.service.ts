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
        },
      },
    },
  });
  return scraps.map(s => s.article);
}
