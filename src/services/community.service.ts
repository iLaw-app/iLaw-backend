import prisma from '../prisma/client';

export async function listPosts(page: number, limit: number) {
  const skip = (page - 1) * limit;
  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        content: true,
        poll: true,
        createdAt: true,
        author: { select: { nickname: true } },
        _count: { select: { likes: true, comments: true } },
      },
    }),
    prisma.communityPost.count(),
  ]);

  return {
    posts: posts.map((p) => ({
      id: p.id,
      nickname: p.author.nickname,
      createdAt: p.createdAt,
      title: p.title,
      content: p.content,
      likes: p._count.likes,
      comments: p._count.comments,
      poll: p.poll ?? null,
    })),
    total,
    page,
    limit,
  };
}

export async function getPost(id: number, userId?: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id },
    include: {
      author: { select: { nickname: true } },
      _count: { select: { likes: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { id: true, nickname: true } } },
      },
    },
  });
  if (!post) return null;

  const liked = userId
    ? !!(await prisma.communityLike.findUnique({
        where: { userId_postId: { userId, postId: id } },
      }))
    : false;

  return {
    id: post.id,
    nickname: post.author.nickname,
    createdAt: post.createdAt,
    title: post.title,
    content: post.content,
    likes: post._count.likes,
    liked,
    poll: post.poll ?? null,
    comments: post.comments.map((c) => ({
      id: c.id,
      nickname: c.author.nickname,
      createdAt: c.createdAt,
      content: c.content,
      isAuthor: userId ? c.author.id === userId : false,
    })),
  };
}

export async function createPost(
  userId: string,
  data: { title: string; content?: string; poll?: object; imageUrls?: string[] },
) {
  return prisma.communityPost.create({
    data: {
      authorId: userId,
      title: data.title,
      content: data.content,
      poll: data.poll ?? undefined,
      imageUrls: data.imageUrls ?? [],
    },
    select: { id: true, title: true, createdAt: true },
  });
}

export async function updatePost(
  id: number,
  userId: string,
  data: { title?: string; content?: string },
) {
  const post = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true } });
  if (!post) return { error: 'not_found' as const };
  if (post.authorId !== userId) return { error: 'forbidden' as const };

  const updated = await prisma.communityPost.update({
    where: { id },
    data: { title: data.title, content: data.content },
    select: { id: true, title: true, content: true, updatedAt: true },
  });
  return { data: updated };
}

export async function deletePost(id: number, userId: string) {
  const post = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true } });
  if (!post) return { error: 'not_found' as const };
  if (post.authorId !== userId) return { error: 'forbidden' as const };

  await prisma.communityPost.delete({ where: { id } });
  return { data: true };
}

export async function toggleLike(postId: number, userId: string) {
  const exists = await prisma.communityLike.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (exists) {
    await prisma.communityLike.delete({ where: { userId_postId: { userId, postId } } });
    return { liked: false };
  } else {
    await prisma.communityLike.create({ data: { userId, postId } });
    return { liked: true };
  }
}

export async function listComments(postId: number) {
  const comments = await prisma.communityComment.findMany({
    where: { postId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { nickname: true } } },
  });
  return comments.map((c) => ({
    id: c.id,
    nickname: c.author.nickname,
    createdAt: c.createdAt,
    content: c.content,
  }));
}

export async function createComment(postId: number, userId: string, content: string) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: 'not_found' as const };

  const comment = await prisma.communityComment.create({
    data: { postId, authorId: userId, content },
    include: { author: { select: { nickname: true } } },
  });
  return {
    data: {
      id: comment.id,
      nickname: comment.author.nickname,
      createdAt: comment.createdAt,
      content: comment.content,
    },
  };
}

export async function deleteComment(commentId: number, userId: string) {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    select: { authorId: true },
  });
  if (!comment) return { error: 'not_found' as const };
  if (comment.authorId !== userId) return { error: 'forbidden' as const };

  await prisma.communityComment.delete({ where: { id: commentId } });
  return { data: true };
}
