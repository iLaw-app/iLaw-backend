import prisma from '../prisma/client';
import { expandQuery } from './synonyms';
import { scoreAndRank } from './search.util';
import { Pagination, paginationArgs } from '../utils/validation';

export async function getCategories() {
  return prisma.manualCategory.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true, slug: true, order: true },
  });
}

export async function getArticlesByCategory(slug: string, pagination?: Pagination) {
  return prisma.manualArticle.findMany({
    ...(pagination ? paginationArgs(pagination) : {}),
    where: { category: { slug } },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: { id: true, question: true, summary: true, order: true },
  });
}

export async function getArticleById(id: number) {
  // 명시 select: 내부용 embedInputHash/embedding을 응답에서 제외한다.
  return prisma.manualArticle.findUnique({
    where: { id },
    select: {
      id: true,
      categoryId: true,
      question: true,
      summary: true,
      content: true,
      order: true,
      category: { select: { name: true, slug: true } },
    },
  });
}

// Shared lexical retrieval core: synonym-expand the query, gather candidate
// articles by trigram-friendly `contains`, then score/rank with the common
// weighted-field ranker. Used by both manual search (category-scoped) and the
// AI diagnosis retrieval (all categories). Keep the returned shape stable —
// searchManualArticles relies on it verbatim.
export async function rankManuals(
  query: string,
  opts: { categorySlug?: string; take?: number; limit?: number } = {},
) {
  const { categorySlug, take = 100, limit } = opts;
  const terms = await expandQuery(query);

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
    take,
  });

  const ranked = scoreAndRank(
    articles,
    terms,
    (a) => [[a.question, 2], [a.summary ?? '', 2], [a.content, 1.5]],
    { phrase: query, ...(limit ? { limit } : {}) },
  );

  return { ranked, expandedTerms: terms };
}

export async function searchManualArticles(query: string, categorySlug?: string, debug = false) {
  const { ranked, expandedTerms } = await rankManuals(query, { categorySlug });
  // embedInputHash는 내부용(재임베딩 판정) 필드이므로 검색 응답에서 제외한다.
  const results = ranked.map(({ score, embedInputHash: _embedInputHash, ...rest }) =>
    debug ? { ...rest, score } : rest);

  return { results, expandedTerms };
}

export async function getAgencies(slug: string, region?: string, pagination?: Pagination) {
  return prisma.agency.findMany({
    ...(pagination ? paginationArgs(pagination) : {}),
    where: {
      category: { slug },
      ...(region ? { region } : {}),
    },
    orderBy: [{ region: 'asc' }, { id: 'asc' }],
    select: { id: true, region: true, name: true, role: true, contact: true },
  });
}
