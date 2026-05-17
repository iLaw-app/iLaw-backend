import prisma from '../prisma/client';

type PollOption = { label: string; votes: number };
type PollData = { options: PollOption[] };

function normalizePoll(poll: unknown): PollData | null {
  if (!poll || typeof poll !== 'object' || !('options' in poll)) return null;
  const options = (poll as { options?: unknown }).options;
  if (!Array.isArray(options)) return null;

  const normalized = options
    .map((option) => {
      if (!option || typeof option !== 'object') return null;
      const label = String((option as { label?: unknown }).label ?? '').trim();
      if (!label) return null;
      const votes = Number((option as { votes?: unknown }).votes ?? 0);
      return { label, votes: Number.isFinite(votes) && votes > 0 ? Math.floor(votes) : 0 };
    })
    .filter((option): option is PollOption => !!option);

  return normalized.length >= 2 ? { options: normalized } : null;
}

function formatPoll(poll: unknown, votedOptionIndex?: number | null) {
  const normalized = normalizePoll(poll);
  if (!normalized) return null;
  return {
    ...normalized,
    total: normalized.options.reduce((sum, option) => sum + option.votes, 0),
    votedOptionIndex: votedOptionIndex ?? null,
  };
}

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
        _count: { select: { likes: true, comments: true, bookmarks: true } },
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
      bookmarks: p._count.bookmarks,
      comments: p._count.comments,
      poll: formatPoll(p.poll),
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
      _count: { select: { likes: true, bookmarks: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { id: true, nickname: true } } },
      },
    },
  });
  if (!post) return null;

  const [liked, bookmarked, vote] = userId
    ? await Promise.all([
        prisma.communityLike.findUnique({ where: { userId_postId: { userId, postId: id } } }),
        prisma.communityBookmark.findUnique({ where: { userId_postId: { userId, postId: id } } }),
        prisma.communityPollVote.findUnique({ where: { userId_postId: { userId, postId: id } } }),
      ])
    : [null, null, null] as const;

  return {
    id: post.id,
    nickname: post.author.nickname,
    createdAt: post.createdAt,
    title: post.title,
    content: post.content,
    imageUrls: post.imageUrls,
    likes: post._count.likes,
    liked: !!liked,
    bookmarks: post._count.bookmarks,
    bookmarked: !!bookmarked,
    poll: formatPoll(post.poll, vote?.optionIndex),
    comments: buildCommentTree(post.comments, userId),
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
      poll: normalizePoll(data.poll) ?? undefined,
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
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: 'not_found' as const };

  const exists = await prisma.communityLike.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (exists) {
    await prisma.communityLike.delete({ where: { userId_postId: { userId, postId } } });
    const count = await prisma.communityLike.count({ where: { postId } });
    return { data: { liked: false, count } };
  } else {
    await prisma.communityLike.create({ data: { userId, postId } });
    const count = await prisma.communityLike.count({ where: { postId } });
    return { data: { liked: true, count } };
  }
}

export async function toggleBookmark(postId: number, userId: string) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: 'not_found' as const };

  const exists = await prisma.communityBookmark.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (exists) {
    await prisma.communityBookmark.delete({ where: { userId_postId: { userId, postId } } });
    const count = await prisma.communityBookmark.count({ where: { postId } });
    return { data: { bookmarked: false, count } };
  }

  await prisma.communityBookmark.create({ data: { userId, postId } });
  const count = await prisma.communityBookmark.count({ where: { postId } });
  return { data: { bookmarked: true, count } };
}

export async function votePoll(postId: number, userId: string, optionIndex: number) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, poll: true },
  });
  if (!post) return { error: 'not_found' as const };

  const poll = normalizePoll(post.poll);
  if (!poll) return { error: 'no_poll' as const };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return { error: 'invalid_option' as const };
  }

  const existing = await prisma.communityPollVote.findUnique({
    where: { userId_postId: { userId, postId } },
  });

  if (existing?.optionIndex === optionIndex) {
    return { data: { poll: formatPoll(poll, optionIndex) } };
  }

  if (existing) {
    poll.options[existing.optionIndex].votes = Math.max(0, poll.options[existing.optionIndex].votes - 1);
  }
  poll.options[optionIndex].votes += 1;

  await prisma.$transaction([
    existing
      ? prisma.communityPollVote.update({
          where: { userId_postId: { userId, postId } },
          data: { optionIndex },
        })
      : prisma.communityPollVote.create({
          data: { userId, postId, optionIndex },
        }),
    prisma.communityPost.update({
      where: { id: postId },
      data: { poll },
    }),
  ]);

  return { data: { poll: formatPoll(poll, optionIndex) } };
}

type CommunityCommentRow = {
  id: number;
  parentId: number | null;
  createdAt: Date;
  content: string;
  author: { id: string; nickname: string | null };
};

function buildCommentTree(comments: CommunityCommentRow[], userId?: string) {
  const mapped = comments.map((c) => ({
    id: c.id,
    nickname: c.author.nickname,
    createdAt: c.createdAt,
    content: c.content,
    parentId: c.parentId,
    isAuthor: userId ? c.author.id === userId : false,
    replies: [] as {
      id: number;
      nickname: string | null;
      createdAt: Date;
      content: string;
      parentId: number | null;
      isAuthor: boolean;
    }[],
  }));

  const byId = new Map(mapped.map((c) => [c.id, c]));
  const roots: typeof mapped = [];
  for (const comment of mapped) {
    if (comment.parentId && byId.has(comment.parentId)) {
      byId.get(comment.parentId)!.replies.push(comment);
    } else {
      roots.push(comment);
    }
  }

  return roots.reverse().map((comment) => ({
    ...comment,
    replies: comment.replies,
  }));
}

export async function listComments(postId: number, userId?: string) {
  const comments = await prisma.communityComment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, nickname: true } } },
  });

  return buildCommentTree(comments, userId);
}

export async function createComment(postId: number, userId: string, content: string, parentId?: number) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) return { error: 'not_found' as const };
  if (parentId) {
    const parent = await prisma.communityComment.findUnique({
      where: { id: parentId },
      select: { id: true, postId: true, parentId: true },
    });
    if (!parent || parent.postId !== postId) return { error: 'parent_not_found' as const };
    if (parent.parentId) return { error: 'nested_reply' as const };
  }

  const comment = await prisma.communityComment.create({
    data: { postId, authorId: userId, content, parentId },
    include: { author: { select: { nickname: true } } },
  });
  return {
    data: {
      id: comment.id,
      nickname: comment.author.nickname,
      createdAt: comment.createdAt,
      content: comment.content,
      parentId: comment.parentId,
      isAuthor: true,
      replies: [],
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
