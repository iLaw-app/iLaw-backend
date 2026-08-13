import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { expandQuery } from './synonyms';
import { scoreAndRank } from './search.util';
import { containsProfanity } from './profanity';
import { moderateAndBlind } from './moderation.service';
import { createNotification } from './notification.service';

const REPORT_DELETE_THRESHOLD = 3;

const COMMENT_MASK = {
  hidden: '욕설이 감지되어 비공개된 댓글입니다.',   // 욕설 자동 감지 → 블라인드
  removed: '신고가 누적되어 삭제된 댓글입니다.',      // 신고 3회 누적 → 자동 삭제
  deleted: '삭제된 댓글입니다.',                      // 작성자 본인 삭제
} as const;

// 목록/상세에 노출하지 않는 게시글 상태 (visible 이 아닌 모든 상태)
const HIDDEN_POST_STATUSES = ['hidden', 'removed', 'deleted'];
// 댓글 수 집계에서 제외할 상태 (삭제·신고삭제. 블라인드는 자리표시로 남으므로 카운트 유지)
const UNCOUNTED_COMMENT_STATUSES = ['removed', 'deleted'];

type PollOptionDefinition = { label: string };
type PollDefinition = { options: PollOptionDefinition[] };
type PollVoteCount = { optionIndex: number; _count: { _all: number } };

function parsePollInput(
  poll: unknown,
): { data: PollDefinition } | { error: 'invalid_poll' } {
  if (!poll || typeof poll !== 'object' || !('options' in poll)) return { error: 'invalid_poll' };
  const options = (poll as { options?: unknown }).options;
  if (!Array.isArray(options)) return { error: 'invalid_poll' };

  const normalized: PollOptionDefinition[] = [];
  for (const option of options) {
    if (!option || typeof option !== 'object') return { error: 'invalid_poll' };
    const label = String((option as { label?: unknown }).label ?? '').trim();
    if (!label) return { error: 'invalid_poll' };
    normalized.push({ label });
  }

  return normalized.length >= 2
    ? { data: { options: normalized } }
    : { error: 'invalid_poll' };
}

function normalizeStoredPoll(poll: unknown): PollDefinition | null {
  if (!poll || typeof poll !== 'object' || !('options' in poll)) return null;
  const options = (poll as { options?: unknown }).options;
  if (!Array.isArray(options)) return null;

  const normalized = options
    .map((option) => {
      if (!option || typeof option !== 'object') return null;
      const label = String((option as { label?: unknown }).label ?? '').trim();
      return label ? { label } : null;
    })
    .filter((option): option is PollOptionDefinition => !!option);

  return normalized.length >= 2 ? { options: normalized } : null;
}

function formatPoll(
  poll: unknown,
  voteCounts: PollVoteCount[] = [],
  votedOptionIndex?: number | null,
) {
  const normalized = normalizeStoredPoll(poll);
  if (!normalized) return null;
  const counts = new Map(voteCounts.map((row) => [row.optionIndex, row._count._all]));
  const options = normalized.options.map((option, index) => ({
    ...option,
    votes: counts.get(index) ?? 0,
  }));
  return {
    options,
    total: options.reduce((sum, option) => sum + option.votes, 0),
    votedOptionIndex: votedOptionIndex ?? null,
  };
}

async function getVoteCounts(postIds: number[]) {
  if (postIds.length === 0) return new Map<number, PollVoteCount[]>();
  const rows = await prisma.communityPollVote.groupBy({
    by: ['postId', 'optionIndex'],
    where: { postId: { in: postIds } },
    _count: { _all: true },
  });

  const byPost = new Map<number, PollVoteCount[]>();
  for (const row of rows) {
    const counts = byPost.get(row.postId) ?? [];
    counts.push({ optionIndex: row.optionIndex, _count: row._count });
    byPost.set(row.postId, counts);
  }
  return byPost;
}

function samePollOptions(left: unknown, right: PollDefinition) {
  const normalized = normalizeStoredPoll(left);
  return !!normalized
    && normalized.options.length === right.options.length
    && normalized.options.every((option, index) => option.label === right.options[index].label);
}

const ANONYMOUS_POST_AUTHOR = '익명';

export async function listPosts(page: number, limit: number) {
  const skip = (page - 1) * limit;
  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      skip,
      take: limit,
      where: { status: 'visible' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        content: true,
        poll: true,
        imageUrls: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { nickname: true } },
        _count: {
          select: {
            likes: true,
            comments: { where: { status: { notIn: UNCOUNTED_COMMENT_STATUSES } } },
            bookmarks: true,
          },
        },
      },
    }),
    prisma.communityPost.count({ where: { status: 'visible' } }),
  ]);
  const voteCounts = await getVoteCounts(posts.map((post) => post.id));

  return {
    posts: posts.map((p) => ({
      id: p.id,
      nickname: ANONYMOUS_POST_AUTHOR,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      title: p.title,
      content: p.content,
      imageUrls: p.imageUrls,
      likes: p._count.likes,
      bookmarks: p._count.bookmarks,
      comments: p._count.comments,
      poll: formatPoll(p.poll, voteCounts.get(p.id)),
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
        orderBy: { createdAt: 'asc' },
        include: {
          author: { select: { id: true, nickname: true } },
          likes: userId ? { where: { userId }, select: { userId: true } } : false,
          _count: { select: { likes: true } },
        },
      },
    },
  });
  if (!post) return null;
  // 비공개/삭제된 게시글은 피드에서도 상세에서도 노출하지 않는다.
  if (HIDDEN_POST_STATUSES.includes(post.status)) return null;

  const [liked, bookmarked, vote, voteCounts] = await Promise.all([
    userId
      ? prisma.communityLike.findUnique({ where: { userId_postId: { userId, postId: id } } })
      : Promise.resolve(null),
    userId
      ? prisma.communityBookmark.findUnique({ where: { userId_postId: { userId, postId: id } } })
      : Promise.resolve(null),
    userId
      ? prisma.communityPollVote.findUnique({ where: { userId_postId: { userId, postId: id } } })
      : Promise.resolve(null),
    getVoteCounts([id]),
  ]);

  const labels = buildLabelMapFromComments(post.comments, post.authorId);

  return {
    id: post.id,
    nickname: ANONYMOUS_POST_AUTHOR,
    isAuthor: userId && post.authorId ? post.authorId === userId : false,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    title: post.title,
    content: post.content,
    imageUrls: post.imageUrls,
    likes: post._count.likes,
    liked: !!liked,
    bookmarks: post._count.bookmarks,
    bookmarked: !!bookmarked,
    poll: formatPoll(post.poll, voteCounts.get(id), vote?.optionIndex),
    comments: buildCommentTree(post.comments, labels, post.authorId, userId),
  };
}

export async function createPost(
  userId: string,
  data: { title: string; content?: string; poll?: object; imageUrls?: string[] },
) {
  // 1차 필터: 로컬 금칙어 사전에 걸리면 작성 자체를 거부한다.
  if (containsProfanity(data.title) || containsProfanity(data.content)) {
    return { error: 'profanity_blocked' as const };
  }

  let poll: PollDefinition | undefined;
  if (data.poll !== undefined) {
    const parsed = parsePollInput(data.poll);
    if ('error' in parsed) return parsed;
    poll = parsed.data;
  }

  const post = await prisma.communityPost.create({
    data: {
      authorId: userId,
      title: data.title,
      content: data.content,
      poll,
      imageUrls: data.imageUrls ?? [],
    },
    select: { id: true, title: true, createdAt: true },
  });

  // 2차 필터: 게시 후 백그라운드 검열(클린봇 방식). 응답을 막지 않는다.
  void moderateAndBlind({
    kind: 'post',
    id: post.id,
    text: [data.title, data.content].filter(Boolean).join('\n'),
    authorId: userId,
  });

  return { data: post };
}

export async function updatePost(
  id: number,
  userId: string,
  data: { title?: string; content?: string; imageUrls?: string[]; poll?: object },
) {
  const post = await prisma.communityPost.findUnique({
    where: { id },
    select: { authorId: true, poll: true },
  });
  if (!post) return { error: 'not_found' as const };
  if (post.authorId !== userId) return { error: 'forbidden' as const };

  let poll: PollDefinition | undefined;
  if (data.poll !== undefined) {
    const parsed = parsePollInput(data.poll);
    if ('error' in parsed) return parsed;
    poll = parsed.data;

    if (!samePollOptions(post.poll, poll)) {
      const voteCount = await prisma.communityPollVote.count({ where: { postId: id } });
      if (voteCount > 0) return { error: 'poll_locked' as const };
    } else {
      poll = undefined;
    }
  }

  const updated = await prisma.communityPost.update({
    where: { id },
    data: {
      title: data.title,
      content: data.content,
      ...(data.imageUrls !== undefined && { imageUrls: data.imageUrls }),
      ...(poll !== undefined && { poll }),
    },
    select: { id: true, title: true, content: true, imageUrls: true, poll: true, updatedAt: true },
  });
  return { data: updated };
}

export async function deletePost(id: number, userId: string) {
  const post = await prisma.communityPost.findUnique({ where: { id }, select: { authorId: true, status: true } });
  if (!post || post.status === 'deleted' || post.status === 'removed') return { error: 'not_found' as const };
  if (post.authorId !== userId) return { error: 'forbidden' as const };

  await prisma.communityPost.update({ where: { id }, data: { status: 'deleted' } });
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

export async function getMyBookmarks(userId: string) {
  const bookmarks = await prisma.communityBookmark.findMany({
    where: { userId, post: { status: 'visible' } },
    orderBy: { createdAt: 'desc' },
    include: {
      post: {
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          updatedAt: true,
          imageUrls: true,
          _count: {
            select: {
              likes: true,
              bookmarks: true,
              comments: { where: { status: { notIn: UNCOUNTED_COMMENT_STATUSES } } },
            },
          },
        },
      },
    },
  });

  return bookmarks.map(({ post }) => ({
    id: post.id,
    nickname: ANONYMOUS_POST_AUTHOR,
    title: post.title,
    content: post.content,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    imageUrls: post.imageUrls,
    likes: post._count.likes,
    bookmarks: post._count.bookmarks,
    comments: post._count.comments,
  }));
}

// 목록의 작성자는 전부 '익명'으로 가려지므로 클라이언트가 목록만 보고 자기 글을
// 골라낼 수 없다. 글마다 상세를 조회해 isAuthor로 판별하는 N+1을 없애기 위한 엔드포인트.
// 응답 형태는 listPosts의 posts 항목과 동일하다.
export async function getMyPosts(userId: string) {
  const posts = await prisma.communityPost.findMany({
    where: { authorId: userId, status: 'visible' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      poll: true,
      imageUrls: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          likes: true,
          comments: { where: { status: { notIn: UNCOUNTED_COMMENT_STATUSES } } },
          bookmarks: true,
        },
      },
    },
  });
  const voteCounts = await getVoteCounts(posts.map((post) => post.id));

  return posts.map((p) => ({
    id: p.id,
    nickname: ANONYMOUS_POST_AUTHOR,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    title: p.title,
    content: p.content,
    imageUrls: p.imageUrls,
    likes: p._count.likes,
    bookmarks: p._count.bookmarks,
    comments: p._count.comments,
    poll: formatPoll(p.poll, voteCounts.get(p.id)),
  }));
}

export async function votePoll(postId: number, userId: string, optionIndex: number) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, poll: true },
  });
  if (!post) return { error: 'not_found' as const };

  const poll = normalizeStoredPoll(post.poll);
  if (!poll) return { error: 'no_poll' as const };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return { error: 'invalid_option' as const };
  }

  await prisma.communityPollVote.upsert({
    where: { userId_postId: { userId, postId } },
    create: { userId, postId, optionIndex },
    update: { optionIndex },
  });

  const voteCounts = await getVoteCounts([postId]);
  return { data: { poll: formatPoll(poll, voteCounts.get(postId), optionIndex) } };
}

type CommunityCommentRow = {
  id: number;
  authorId: string | null;
  parentId: number | null;
  createdAt: Date;
  content: string;
  status: string;
  author: { id: string; nickname: string | null } | null;
  likes?: { userId: string }[];
  _count: { likes: number };
};

type CommunityCommentResponse = {
  id: number;
  nickname: string;
  createdAt: Date;
  content: string;
  likes: number;
  liked: boolean;
  parentId: number | null;
  isAuthor: boolean;
  isPostAuthor: boolean;
  replies: CommunityCommentResponse[];
};

function buildCommentTree(
  comments: CommunityCommentRow[],
  labels: Map<string, number>,
  postAuthorId: string | null,
  userId?: string,
) {
  const mapped: CommunityCommentResponse[] = comments.map((c) => {
    // visible이 아닌 댓글(욕설 블라인드/신고삭제/작성자삭제)은 원문·좋아요를 가리고 원인별 안내문만 노출한다.
    const masked = c.status !== 'visible';
    const content = masked
      ? (COMMENT_MASK[c.status as keyof typeof COMMENT_MASK] ?? COMMENT_MASK.deleted)
      : c.content;
    const likes = masked ? 0 : c._count.likes;
    const liked = masked ? false : !!c.likes?.length;

    const authorId = c.author?.id ?? c.authorId ?? null;
    if (!authorId) {
      return {
        id: c.id,
        nickname: ANONYMOUS_POST_AUTHOR,
        createdAt: c.createdAt,
        content,
        likes,
        liked,
        parentId: c.parentId,
        isAuthor: false,
        isPostAuthor: false,
        replies: [],
      };
    }
    const isPostAuthor = !!postAuthorId && authorId === postAuthorId;
    return {
      id: c.id,
      nickname: isPostAuthor ? '익명(글쓴이)' : `익명${labels.get(authorId) ?? '?'}`,
      createdAt: c.createdAt,
      content,
      likes,
      liked,
      parentId: c.parentId,
      isAuthor: userId ? authorId === userId : false,
      isPostAuthor,
      replies: [],
    };
  });

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

// 댓글 작성자 등장 순서로 익명 번호를 직접 매긴다 (별도 라벨 테이블에 의존하지 않아 누락 없이 모두 번호가 붙음).
// 글쓴이(게시글 작성자)는 '익명(글쓴이)'로 표시되므로 번호 대상에서 제외.
function buildLabelMapFromComments(
  comments: { authorId?: string | null; author: { id: string } | null; createdAt: Date }[],
  postAuthorId: string | null,
): Map<string, number> {
  const ordered = [...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const map = new Map<string, number>();
  let n = 0;
  for (const c of ordered) {
    const id = c.author?.id ?? c.authorId;
    if (!id) continue;
    if (postAuthorId && id === postAuthorId) continue;
    if (!map.has(id)) { n++; map.set(id, n); }
  }
  return map;
}

export async function listComments(postId: number, userId?: string) {
  const [post, comments] = await Promise.all([
    prisma.communityPost.findUnique({ where: { id: postId }, select: { authorId: true } }),
    prisma.communityComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, nickname: true } },
        likes: userId ? { where: { userId }, select: { userId: true } } : false,
        _count: { select: { likes: true } },
      },
    }),
  ]);

  if (!post) return [];

  const labels = buildLabelMapFromComments(comments, post.authorId);
  return buildCommentTree(comments, labels, post.authorId, userId);
}

export async function createComment(postId: number, userId: string, content: string, parentId?: number) {
  // 1차 필터: 로컬 금칙어 사전에 걸리면 작성 자체를 거부한다.
  if (containsProfanity(content)) return { error: 'profanity_blocked' as const };

  const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true, authorId: true, status: true } });
  if (!post || HIDDEN_POST_STATUSES.includes(post.status)) return { error: 'not_found' as const };
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
  });

  // 2차 필터: 게시 후 백그라운드 검열(클린봇 방식). 응답을 막지 않는다.
  void moderateAndBlind({ kind: 'comment', id: comment.id, text: content, authorId: userId });

  // 방금 생성한 댓글까지 포함해 작성자 등장 순서로 번호를 다시 계산
  const allComments = await prisma.communityComment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    select: { author: { select: { id: true } }, createdAt: true },
  });
  const labels = buildLabelMapFromComments(allComments, post.authorId);
  const isPostAuthor = !!post.authorId && userId === post.authorId;
  const nickname = isPostAuthor ? '익명(글쓴이)' : `익명${labels.get(userId) ?? 1}`;

  return {
    data: {
      id: comment.id,
      nickname,
      createdAt: comment.createdAt,
      content: comment.content,
      likes: 0,
      liked: false,
      parentId: comment.parentId,
      isAuthor: true,
      isPostAuthor,
      replies: [],
    },
  };
}

export async function deleteComment(commentId: number, userId: string) {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    select: { authorId: true, status: true },
  });
  if (!comment || comment.status === 'deleted' || comment.status === 'removed') return { error: 'not_found' as const };
  if (comment.authorId !== userId) return { error: 'forbidden' as const };

  await prisma.communityComment.update({ where: { id: commentId }, data: { status: 'deleted' } });
  return { data: true };
}

export async function searchCommunityPosts(query: string, debug = false) {
  const terms = await expandQuery(query);

  const posts = await prisma.communityPost.findMany({
    where: {
      status: 'visible',
      OR: terms.flatMap((term) => [
        { title: { contains: term } },
        { content: { contains: term } },
      ]),
    },
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
      _count: {
        select: {
          likes: true,
          comments: { where: { status: { not: 'deleted' } } },
          bookmarks: true,
        },
      },
    },
    take: 100,
  });

  const ranked = scoreAndRank(
    posts,
    terms,
    (p) => [[p.title, 2], [p.content ?? '', 1.5]],
    { phrase: query },
  );

  const results = ranked
    .map(({ score, _count, ...rest }) =>
      debug
        ? { ...rest, nickname: ANONYMOUS_POST_AUTHOR, likes: _count.likes, bookmarks: _count.bookmarks, comments: _count.comments, score }
        : { ...rest, nickname: ANONYMOUS_POST_AUTHOR, likes: _count.likes, bookmarks: _count.bookmarks, comments: _count.comments },
    );

  return { results, expandedTerms: terms };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function reportComment(commentId: number, userId: string, reason?: string) {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
    select: { authorId: true, status: true },
  });
  if (!comment || comment.status === 'deleted' || comment.status === 'removed') return { error: 'not_found' as const };
  if (comment.authorId && comment.authorId === userId) return { error: 'cannot_report_self' as const };

  try {
    await prisma.communityCommentReport.create({ data: { commentId, reporterId: userId, reason } });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'already_reported' as const };
    throw error;
  }

  // unique(commentId, reporterId) 제약이 있으므로 신고 건수 = 서로 다른 신고자 수.
  const count = await prisma.communityCommentReport.count({ where: { commentId } });
  let deleted = false;
  if (count >= REPORT_DELETE_THRESHOLD) {
    const updated = await prisma.communityComment.updateMany({
      where: { id: commentId, status: { notIn: ['deleted', 'removed'] } },
      data: { status: 'removed' },
    });
    if (updated.count > 0) {
      deleted = true;
      if (comment.authorId) {
        await createNotification(
          comment.authorId,
          'community_removed',
          '댓글이 삭제되었습니다',
          '신고가 누적되어 작성하신 댓글이 삭제되었습니다.',
          commentId,
        );
      }
    }
  }

  return { data: { reported: true, count, deleted } };
}

export async function reportPost(postId: number, userId: string, reason?: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { authorId: true, status: true },
  });
  if (!post || post.status === 'deleted' || post.status === 'removed') return { error: 'not_found' as const };
  if (post.authorId && post.authorId === userId) return { error: 'cannot_report_self' as const };

  try {
    await prisma.communityPostReport.create({ data: { postId, reporterId: userId, reason } });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: 'already_reported' as const };
    throw error;
  }

  const count = await prisma.communityPostReport.count({ where: { postId } });
  let deleted = false;
  if (count >= REPORT_DELETE_THRESHOLD) {
    const updated = await prisma.communityPost.updateMany({
      where: { id: postId, status: { notIn: ['deleted', 'removed'] } },
      data: { status: 'removed' },
    });
    if (updated.count > 0) {
      deleted = true;
      if (post.authorId) {
        await createNotification(
          post.authorId,
          'community_removed',
          '게시글이 삭제되었습니다',
          '신고가 누적되어 작성하신 게시글이 삭제되었습니다.',
          postId,
        );
      }
    }
  }

  return { data: { reported: true, count, deleted } };
}

export async function toggleCommentLike(commentId: number, userId: string) {
  const comment = await prisma.communityComment.findUnique({ where: { id: commentId }, select: { id: true } });
  if (!comment) return { error: 'not_found' as const };

  const exists = await prisma.communityCommentLike.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });

  if (exists) {
    await prisma.communityCommentLike.delete({ where: { userId_commentId: { userId, commentId } } });
    const count = await prisma.communityCommentLike.count({ where: { commentId } });
    return { data: { liked: false, count } };
  }

  await prisma.communityCommentLike.create({ data: { userId, commentId } });
  const count = await prisma.communityCommentLike.count({ where: { commentId } });
  return { data: { liked: true, count } };
}
