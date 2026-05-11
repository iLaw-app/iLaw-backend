import prisma from '../prisma/client';

export async function listQnAPosts() {
  return prisma.qnAPost.findMany({
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

export async function createQnAPost(authorId: string, title: string, content: string, category: string) {
  return prisma.qnAPost.create({
    data: { authorId, title, content, category },
  });
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
