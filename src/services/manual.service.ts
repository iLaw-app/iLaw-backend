import prisma from '../prisma/client';

export async function getCategories() {
  return prisma.manualCategory.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true, slug: true, order: true },
  });
}

export async function getArticlesByCategory(slug: string) {
  return prisma.manualArticle.findMany({
    where: { category: { slug } },
    orderBy: { order: 'asc' },
    select: { id: true, question: true, summary: true, order: true },
  });
}

export async function getArticleById(id: number) {
  return prisma.manualArticle.findUnique({
    where: { id },
    include: { category: { select: { name: true, slug: true } } },
  });
}

export async function searchManualArticles(query: string) {
  return prisma.manualArticle.findMany({
    where: {
      OR: [
        { question: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      question: true,
      summary: true,
      category: { select: { name: true, slug: true } },
    },
    take: 20,
  });
}

export async function getAgencies(slug: string, region?: string) {
  return prisma.agency.findMany({
    where: {
      category: { slug },
      ...(region ? { region } : {}),
    },
    orderBy: [{ region: 'asc' }, { id: 'asc' }],
    select: { id: true, region: true, name: true, role: true, contact: true },
  });
}
