export const COMMENT_MASK = {
  hidden: '욕설이 감지되어 비공개된 댓글입니다.',
  removed: '신고가 누적되어 삭제된 댓글입니다.',
  deleted: '삭제된 댓글입니다.',
} as const;

export const HIDDEN_POST_STATUSES = ['hidden', 'removed', 'deleted'];
export const UNCOUNTED_COMMENT_STATUSES = ['removed', 'deleted'];
export const ANONYMOUS_POST_AUTHOR = '익명';
