import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { getEmbedding } from './embedding.service';

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

type ArticleSearchRow = {
  id: bigint;
  question: string;
  summary: string | null;
  category_name: string;
  category_slug: string;
};

export async function searchManualArticles(query: string) {
  const embedding = await getEmbedding(query);
  const vectorStr = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw<ArticleSearchRow[]>(
    Prisma.sql`
      SELECT a.id, a.question, a.summary,
             c.name AS category_name, c.slug AS category_slug
      FROM "ManualArticle" a
      JOIN "ManualCategory" c ON c.id = a."categoryId"
      WHERE a.embedding IS NOT NULL
        AND a.embedding <=> ${vectorStr}::vector < 0.7
      ORDER BY a.embedding <=> ${vectorStr}::vector
      LIMIT 10
    `
  );

  return rows.map((r) => ({
    id: Number(r.id),
    question: r.question,
    summary: r.summary,
    category: { name: r.category_name, slug: r.category_slug },
  }));
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
