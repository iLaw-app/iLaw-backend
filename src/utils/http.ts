import { Response } from 'express';
import { Pagination, parsePagination, parsePositiveInteger } from './validation';

// Parse a route param into a safe positive integer id, or null if invalid.
export function parseId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  return parsePositiveInteger(raw);
}

// Parse an id and, if invalid, write a 400 response and return null.
// Callers: `const id = requireId(res, req.params.id); if (id === null) return;`
export function requireId(res: Response, raw: unknown, message = '잘못된 ID입니다.'): number | null {
  const id = parseId(raw);
  if (id === null) {
    res.status(400).json({ message });
    return null;
  }
  return id;
}

export function requirePagination(
  res: Response,
  query: Record<string, unknown>,
  message = '요청 내용을 확인해주세요.',
): Pagination | null {
  const parsed = parsePagination(query);
  if ('error' in parsed) {
    res.status(400).json({ message });
    return null;
  }
  return parsed.data;
}

export function setPaginationHeaders(res: Response, pagination: Pagination): void {
  res.setHeader('Access-Control-Expose-Headers', 'X-Pagination-Page, X-Pagination-Limit');
  res.setHeader('X-Pagination-Page', String(pagination.page));
  res.setHeader('X-Pagination-Limit', String(pagination.limit));
}

type ErrorSpec = { status: number; message: string };

const SERVICE_ERROR_DEFAULTS: Record<string, ErrorSpec> = {
  not_found: { status: 404, message: '게시글을 찾을 수 없습니다.' },
  forbidden: { status: 403, message: '권한이 없습니다.' },
  no_poll: { status: 400, message: '투표가 없는 게시글입니다.' },
  invalid_option: { status: 400, message: '잘못된 선택지입니다.' },
  parent_not_found: { status: 404, message: '원댓글을 찾을 수 없습니다.' },
  nested_reply: { status: 400, message: '답글에는 다시 답글을 달 수 없습니다.' },
  poll_locked: { status: 409, message: '투표가 시작된 후에는 선택지를 변경할 수 없습니다.' },
  invalid_poll: { status: 400, message: '투표 선택지를 확인해주세요.' },
  invalid_title: { status: 400, message: '제목을 확인해주세요.' },
  invalid_content: { status: 400, message: '본문 내용을 확인해주세요.' },
  invalid_comment: { status: 400, message: '댓글 내용을 확인해주세요.' },
  invalid_image_urls: { status: 400, message: '이미지 URL을 확인해주세요.' },
  invalid_query: { status: 400, message: '검색어를 확인해주세요.' },
  invalid_parent_id: { status: 400, message: '원댓글 ID를 확인해주세요.' },
  invalid_request: { status: 400, message: '요청 내용을 확인해주세요.' },
  profanity_blocked: { status: 400, message: '부적절한 표현이 포함되어 있어 등록할 수 없습니다.' },
  already_reported: { status: 409, message: '이미 신고한 대상입니다.' },
  cannot_report_self: { status: 400, message: '본인이 작성한 글은 신고할 수 없습니다.' },
};

// Map a service error code to an HTTP response. `overrides` customises the
// message/status for a given code (e.g. comment-specific "not_found").
export function sendServiceError(
  res: Response,
  error: string,
  overrides: Record<string, ErrorSpec> = {},
): void {
  const spec = overrides[error] ?? SERVICE_ERROR_DEFAULTS[error] ?? { status: 400, message: '요청을 처리할 수 없습니다.' };
  res.status(spec.status).json({ message: spec.message });
}
