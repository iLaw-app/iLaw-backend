import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { getEmbedding } from './embedding.service';
import { expandQuery } from './synonyms';

export async function listQnAPosts() {
  return prisma.qnAPost.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      status: true,
      createdAt: true,
      author: { select: { nickname: true } },
    },
  });
}

export async function getQnAPost(id: number) {
  return prisma.qnAPost.findUnique({
    where: { id },
    include: {
      author: { select: { nickname: true } },
      answer: {
        include: {
          lawyer: { select: { nickname: true, role: true } },
        },
      },
    },
  });
}

export async function createQnAPost(authorId: string, title: string, content: string, category: string, imageUrls: string[] = []) {
  return prisma.qnAPost.create({
    data: { authorId, title, content, category, imageUrls },
  });
}

export async function embedQnAPost(postId: number, text: string) {
  const embedding = await getEmbedding(text);
  const vectorStr = `[${embedding.join(',')}]`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "QnAPost" SET embedding = ${vectorStr}::vector WHERE id = ${postId}`
  );
}

type QnASearchRow = {
  id: bigint;
  title: string;
  category: string;
  status: string;
  created_at: Date;
  author_nickname: string | null;
};

export async function searchQnAPosts(query: string) {
  const embedding = await getEmbedding(expandQuery(query));
  const vectorStr = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw<QnASearchRow[]>(
    Prisma.sql`
      SELECT p.id, p.title, p.category, p.status, p."createdAt" AS created_at,
             u.nickname AS author_nickname
      FROM "QnAPost" p
      JOIN "User" u ON u.id = p."authorId"
      WHERE p.embedding IS NOT NULL
        AND p.embedding <=> ${vectorStr}::vector < 0.65
      ORDER BY p.embedding <=> ${vectorStr}::vector
      LIMIT 10
    `
  );

  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    category: r.category,
    status: r.status,
    createdAt: r.created_at,
    author: { nickname: r.author_nickname },
  }));
}

export async function listUserQnAPosts(authorId: string) {
  return prisma.qnAPost.findMany({
    where: { authorId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      createdAt: true,
      author: { select: { nickname: true } },
    },
  });
}

export async function createQnAAnswer(postId: number, lawyerId: string, content: string) {
  const [answer] = await prisma.$transaction([
    prisma.qnAAnswer.create({ data: { postId, lawyerId, content } }),
    prisma.qnAPost.update({ where: { id: postId }, data: { status: 'answered' } }),
  ]);
  return answer;
}
