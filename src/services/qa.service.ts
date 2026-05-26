import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { getEmbedding } from './embedding.service';
import { expandQuery } from './synonyms';

export async function listQAPosts(userId?: string) {
  const posts = await prisma.qnAPost.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      status: true,
      createdAt: true,
      author: { select: { nickname: true } },
      _count: { select: { scraps: true } },
      ...(userId ? { scraps: { where: { userId }, select: { id: true } } } : {}),
    },
  });

  return posts.map(({ _count, scraps, ...p }: any) => ({
    ...p,
    scrapCount: _count.scraps,
    scrapped: userId ? (scraps?.length ?? 0) > 0 : undefined,
  }));
}

function calcKoreanAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  return hasBirthdayPassed ? age : age - 1;
}

export async function getQAPost(id: number) {
  const post = await prisma.qnAPost.findUnique({
    where: { id },
    include: {
      author: { select: { nickname: true, birthDate: true, region: true, gender: true } },
      answer: {
        include: {
          lawyer: { select: { nickname: true, role: true, affiliation: true } },
        },
      },
    },
  });

  if (!post) return null;

  return {
    ...post,
    author: post.author
      ? {
          nickname: post.author.nickname,
          birthDate: post.author.birthDate ? post.author.birthDate.toISOString().slice(0, 10) : null,
          region: post.author.region,
          gender: post.author.gender,
        }
      : null,
  };
}

export async function updateQAAnswer(postId: number, lawyerId: string, content: string): Promise<boolean> {
  const answer = await prisma.qnAAnswer.findUnique({ where: { postId }, select: { lawyerId: true } });
  if (!answer || answer.lawyerId !== lawyerId) return false;
  await prisma.qnAAnswer.update({ where: { postId }, data: { content } });
  return true;
}

export async function createQAPost(authorId: string, title: string, content: string, category: string, imageUrls: string[] = []) {
  return prisma.qnAPost.create({
    data: { authorId, title, content, category, imageUrls },
  });
}

export async function embedQAPost(postId: number, text: string) {
  const embedding = await getEmbedding(text);
  const vectorStr = `[${embedding.join(',')}]`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "QnAPost" SET embedding = ${vectorStr}::vector WHERE id = ${postId}`
  );
}

export async function searchQAPosts(query: string, debug = false) {
  const terms = expandQuery(query);

  const posts = await prisma.qnAPost.findMany({
    where: {
      OR: [
        ...terms.flatMap((term) => [
          { title: { contains: term } },
          { content: { contains: term } },
        ]),
        ...terms.map((term) => ({
          answer: { content: { contains: term } },
        })),
      ],
    },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      status: true,
      createdAt: true,
      author: { select: { nickname: true } },
      answer: { select: { content: true } },
    },
    take: 30,
  });

  const scored = posts.map((p) => ({
    ...p,
    score: terms.reduce(
      (acc, term) =>
        acc +
        (p.title.includes(term) ? 2 : 0) +
        (p.content.includes(term) ? 1.5 : 0) +
        ((p.answer?.content ?? '').includes(term) ? 1 : 0),
      0,
    ),
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);
  const threshold = sorted.some((p) => p.score >= 10) ? 10
    : sorted.some((p) => p.score >= 6) ? 6
    : 3;

  const results = sorted
    .filter((p) => p.score >= threshold)
    .slice(0, 10)
    .map(({ score, ...rest }) => debug ? { ...rest, score } : rest);

  return { results, expandedTerms: terms };
}

export async function listUserQAPosts(authorId: string) {
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

export async function listLawyerAnswers(lawyerId: string) {
  const answers = await prisma.qnAAnswer.findMany({
    where: { lawyerId },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      post: {
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          createdAt: true,
        },
      },
    },
  });
  return answers.map(a => ({
    id: a.post.id,
    title: a.post.title,
    content: a.post.content,
    category: a.post.category,
    createdAt: a.post.createdAt,
    answeredAt: a.createdAt,
  }));
}

export async function deleteQAPost(id: number, userId: string): Promise<boolean> {
  const post = await prisma.qnAPost.findUnique({ where: { id }, select: { authorId: true } });
  if (!post || post.authorId !== userId) return false;
  await prisma.$transaction([
    prisma.qnAAnswer.deleteMany({ where: { postId: id } }),
    prisma.qnAPost.delete({ where: { id } }),
  ]);
  return true;
}

export async function createQAAnswer(postId: number, lawyerId: string, content: string) {
  const [answer] = await prisma.$transaction([
    prisma.qnAAnswer.create({ data: { postId, lawyerId, content } }),
    prisma.qnAPost.update({ where: { id: postId }, data: { status: 'answered' } }),
  ]);
  return answer;
}
