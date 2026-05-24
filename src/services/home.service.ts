import prisma from '../prisma/client';

export async function getPopularContent(limit = 5) {
  const [manualArticles, qnaPosts] = await Promise.all([
    prisma.manualArticle.findMany({
      select: {
        id: true,
        question: true,
        category: { select: { name: true } },
        _count: { select: { scraps: true } },
      },
      orderBy: { scraps: { _count: 'desc' } },
      take: limit,
    }),
    prisma.qnAPost.findMany({
      where: { status: 'answered' },
      select: {
        id: true,
        title: true,
        category: true,
        _count: { select: { scraps: true } },
      },
      orderBy: { scraps: { _count: 'desc' } },
      take: limit,
    }),
  ]);

  const combined = [
    ...manualArticles.map(a => ({
      type: 'manual' as const,
      id: a.id,
      label: a.question,
      category: a.category.name,
      scrapCount: a._count.scraps,
    })),
    ...qnaPosts.map(p => ({
      type: 'qna' as const,
      id: p.id,
      label: p.title,
      category: p.category,
      scrapCount: p._count.scraps,
    })),
  ];

  combined.sort((a, b) => b.scrapCount - a.scrapCount);

  return combined.slice(0, limit).map(({ scrapCount: _sc, ...item }) => item);
}
