import prisma from '../prisma/client';
import { expandQuery } from './synonyms';
import { scoreAndRank } from './search.util';

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

export async function searchManualArticles(query: string, categorySlug?: string, debug = false) {
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

  const ranked = scoreAndRank(
    articles,
    terms,
    (a) => [[a.question, 2], [a.summary ?? '', 2], [a.content, 1.5]],
    3,
  );
  const results = ranked.map(({ score, ...rest }) => debug ? { ...rest, score } : rest);

  return { results, expandedTerms: terms };
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
