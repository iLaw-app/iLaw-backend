import { ANONYMOUS_POST_AUTHOR, COMMENT_MASK } from './community-shared';

export type CommunityCommentRow = {
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

export type CommunityCommentResponse = {
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

export function buildCommentTree(
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
export function buildLabelMapFromComments(
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
