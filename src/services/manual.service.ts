import prisma from '../prisma/client';
import { expandQuery } from './synonyms';

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

export async function searchManualArticles(query: string, categorySlug?: string) {
  const terms = expandQuery(query);

  const articles = await prisma.manualArticle.findMany({
    where: {
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      OR: terms.flatMap((term) => [
        { question: { contains: term } },
        { summary: { contains: term } },
        { content: { contains: term } },
      ]),
    },
    include: { category: { select: { name: true, slug: true } } },
    take: 30,
  });

  const scored = articles.map((a) => ({
    ...a,
    score: terms.reduce(
      (acc, term) =>
        acc +
        (a.question.includes(term) ? 2 : 0) +
        ((a.summary ?? '').includes(term) ? 2 : 0) +
        (a.content.includes(term) ? 1.5 : 0),
      0,
    ),
  }));

  return scored
    .filter((a) => a.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score: _score, ...rest }) => rest);
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
