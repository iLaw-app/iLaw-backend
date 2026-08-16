import { beforeEach, describe, expect, it, vi } from 'vitest';

const qaService = vi.hoisted(() => ({
  listQAPosts: vi.fn(), listUserQAPosts: vi.fn(), listLawyerAnswers: vi.fn(),
  getQAPostDetail: vi.fn(), getQAPostAnswerState: vi.fn(), createQAPost: vi.fn(),
  createQAAnswer: vi.fn(), updateQAAnswer: vi.fn(), searchQAPosts: vi.fn(), deleteQAPost: vi.fn(),
}));
const notificationService = vi.hoisted(() => ({
  createNotificationsForLawyers: vi.fn(), getUserNotifications: vi.fn(),
  markAllRead: vi.fn(), getUnreadCount: vi.fn(),
}));
const manualService = vi.hoisted(() => ({
  getCategories: vi.fn(), getArticlesByCategory: vi.fn(), getArticleById: vi.fn(),
  getAgencies: vi.fn(), searchManualArticles: vi.fn(),
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock('../src/services/qa.service', () => qaService);
vi.mock('../src/services/notification.service', () => notificationService);
vi.mock('../src/services/manual.service', () => manualService);
vi.mock('../src/middlewares/logging', () => ({ logger }));

import * as qaController from '../src/controllers/qa.controller';
import * as manualController from '../src/controllers/manual.controller';
import * as notificationController from '../src/controllers/notification.controller';

function response() {
  const json = vi.fn();
  const send = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn(() => ({ json, send }));
  return { res: { status, json, send, setHeader } as never, status, json, setHeader };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AWS_CDN_BASE_URL = 'https://cdn.example.com';
  qaService.listQAPosts.mockResolvedValue([]);
  qaService.listUserQAPosts.mockResolvedValue([]);
  qaService.listLawyerAnswers.mockResolvedValue([]);
  qaService.createQAPost.mockResolvedValue({ id: 7 });
  notificationService.createNotificationsForLawyers.mockResolvedValue(undefined);
  notificationService.getUserNotifications.mockResolvedValue([]);
  manualService.getArticlesByCategory.mockResolvedValue([]);
  manualService.getAgencies.mockResolvedValue([]);
  manualService.searchManualArticles.mockResolvedValue({ results: [], expandedTerms: [] });
});

describe('Q&A controller validation과 pagination', () => {
  it('목록 query의 기본 pagination을 서비스에 전달하고 배열 shape/header를 유지한다', async () => {
    qaService.listQAPosts.mockResolvedValue([{ id: 1, author: { nickname: '실명' } }]);
    const { res, json, setHeader } = response();
    await qaController.listPosts({ query: {} } as never, res);
    expect(qaService.listQAPosts).toHaveBeenCalledWith(undefined, { page: 1, limit: 20 });
    expect(setHeader).toHaveBeenCalledWith(
      'Access-Control-Expose-Headers',
      'X-Pagination-Page, X-Pagination-Limit',
    );
    expect(setHeader).toHaveBeenCalledWith('X-Pagination-Page', '1');
    expect(setHeader).toHaveBeenCalledWith('X-Pagination-Limit', '20');
    expect(json).toHaveBeenCalledWith([{ id: 1, author: { nickname: '익명' } }]);
  });

  it('Q&A 빈 후속 page도 배열 shape와 pagination/CORS 노출 header를 유지한다', async () => {
    const { res, json, setHeader } = response();
    await qaController.listPosts({ query: { page: '2' } } as never, res);
    expect(json).toHaveBeenCalledWith([]);
    expect(setHeader).toHaveBeenCalledWith(
      'Access-Control-Expose-Headers',
      'X-Pagination-Page, X-Pagination-Limit',
    );
    expect(setHeader).toHaveBeenCalledWith('X-Pagination-Page', '2');
    expect(setHeader).toHaveBeenCalledWith('X-Pagination-Limit', '20');
  });

  it('잘못된 pagination을 400으로 거부한다', async () => {
    const { res, status } = response();
    await qaController.listPosts({ query: { limit: '101' } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(qaService.listQAPosts).not.toHaveBeenCalled();
  });

  it('내 질문과 내 답변 pagination을 서비스에 전달한다', async () => {
    const first = response();
    await qaController.listMyPosts({ userId: 'me', query: { page: '2', limit: '10' } } as never, first.res);
    expect(qaService.listUserQAPosts).toHaveBeenCalledWith('me', { page: 2, limit: 10 });

    const second = response();
    await qaController.listMyAnswers({ userId: 'lawyer', query: {} } as never, second.res);
    expect(qaService.listLawyerAnswers).toHaveBeenCalledWith('lawyer', { page: 1, limit: 20 });
  });

  it('생성 payload를 검증·trim한 뒤 서비스에 전달한다', async () => {
    const { res } = response();
    await qaController.createPost({ userId: 'me', body: {
      title: ' 제목 ', content: ' 본문 ', category: ' labor ',
      imageUrls: [' https://cdn.example.com/uploads/a.jpg '],
    } } as never, res);
    expect(qaService.createQAPost).toHaveBeenCalledWith(
      'me', '제목', '본문', 'labor', ['https://cdn.example.com/uploads/a.jpg'],
    );
  });

  it('잘못된 이미지 URL과 답변 타입을 400으로 거부한다', async () => {
    const post = response();
    await qaController.createPost({ userId: 'me', body: {
      title: '제목', content: '본문', category: 'labor', imageUrls: ['https://evil.example/a'],
    } } as never, post.res);
    expect(post.status).toHaveBeenCalledWith(400);
    expect(qaService.createQAPost).not.toHaveBeenCalled();

    const answer = response();
    await qaController.createAnswer({ userId: 'lawyer', params: { id: '1' }, body: { content: 123 } } as never, answer.res);
    expect(answer.status).toHaveBeenCalledWith(400);
    expect(qaService.getQAPostAnswerState).not.toHaveBeenCalled();
  });

  it('unsafe 숫자 params를 기존 Invalid id 계약으로 거부한다', async () => {
    const { res, status, json } = response();
    await qaController.getPost({ params: { id: '1e2' } } as never, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid id' });
    expect(qaService.getQAPostDetail).not.toHaveBeenCalled();
  });

  it('비동기 알림 실패를 structured logger로 기록한다', async () => {
    notificationService.createNotificationsForLawyers.mockRejectedValue(new Error('database unavailable'));
    const { res } = response();
    await qaController.createPost({ userId: 'me', body: {
      title: '제목', content: '본문', category: 'labor', imageUrls: [],
    } } as never, res);
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      event: 'notification_create_failed', error: 'database unavailable', refId: 7,
    })));
  });
});

describe('manual/notification controller validation', () => {
  it('manual 검색 query를 검증·trim한다', async () => {
    const { res } = response();
    await manualController.searchArticles({ query: { q: ' 임금 ', categorySlug: ' labor ', debug: 'true' } } as never, res);
    expect(manualService.searchManualArticles).toHaveBeenCalledWith('임금', 'labor', true);
  });

  it('manual 배열 검색어와 unsafe article id를 400으로 거부한다', async () => {
    const search = response();
    await manualController.searchArticles({ query: { q: ['임금'] } } as never, search.res);
    expect(search.status).toHaveBeenCalledWith(400);

    const article = response();
    await manualController.getArticle({ params: { id: '9007199254740992' } } as never, article.res);
    expect(article.status).toHaveBeenCalledWith(400);
    expect(manualService.getArticleById).not.toHaveBeenCalled();
  });

  it('manual article과 agency 목록 pagination을 전달한다', async () => {
    manualService.getArticlesByCategory.mockResolvedValue([{}]);
    const articles = response();
    await manualController.listArticles({ params: { slug: 'labor' }, query: { page: '2', limit: '10' } } as never, articles.res);
    expect(manualService.getArticlesByCategory).toHaveBeenCalledWith('labor', { page: 2, limit: 10 });
    expect(articles.setHeader).toHaveBeenCalledWith('X-Pagination-Limit', '10');

    const agencies = response();
    await manualController.listAgencies({ params: { slug: 'labor' }, query: { region: '서울', limit: '5' } } as never, agencies.res);
    expect(manualService.getAgencies).toHaveBeenCalledWith('labor', '서울', { page: 1, limit: 5 });
    expect(agencies.json).toHaveBeenCalledWith([]);
    expect(agencies.setHeader).toHaveBeenCalledWith(
      'Access-Control-Expose-Headers',
      'X-Pagination-Page, X-Pagination-Limit',
    );
  });

  it('manual 범위를 벗어난 후속 page는 카테고리 404 대신 빈 배열을 반환한다', async () => {
    manualService.getArticlesByCategory.mockResolvedValue([]);
    const { res, status, json } = response();
    await manualController.listArticles({ params: { slug: 'labor' }, query: { page: '3' } } as never, res);
    expect(status).not.toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith([]);
  });

  it('notification pagination을 검증해 정상 배열과 CORS 노출 header를 유지한다', async () => {
    notificationService.getUserNotifications.mockResolvedValue([{ id: 1 }]);
    const valid = response();
    await notificationController.listNotifications({ userId: 'me', query: { page: '3', limit: '10' } } as never, valid.res);
    expect(notificationService.getUserNotifications).toHaveBeenCalledWith('me', { page: 3, limit: 10 });
    expect(valid.setHeader).toHaveBeenCalledWith('X-Pagination-Page', '3');
    expect(valid.setHeader).toHaveBeenCalledWith(
      'Access-Control-Expose-Headers',
      'X-Pagination-Page, X-Pagination-Limit',
    );
    expect(valid.json).toHaveBeenCalledWith([{ id: 1 }]);

    const invalid = response();
    await notificationController.listNotifications({ userId: 'me', query: { limit: ['10'] } } as never, invalid.res);
    expect(invalid.status).toHaveBeenCalledWith(400);
  });

  it('notification 빈 후속 page도 배열 shape와 header를 유지한다', async () => {
    const { res, json, setHeader } = response();
    await notificationController.listNotifications({ userId: 'me', query: { page: '4' } } as never, res);
    expect(json).toHaveBeenCalledWith([]);
    expect(setHeader).toHaveBeenCalledWith('X-Pagination-Page', '4');
    expect(setHeader).toHaveBeenCalledWith('X-Pagination-Limit', '20');
  });

  it('manual pagination의 0/소수와 notification 여분 query를 400으로 거부한다', async () => {
    const article = response();
    await manualController.listArticles({ params: { slug: 'labor' }, query: { page: '0' } } as never, article.res);
    expect(article.status).toHaveBeenCalledWith(400);
    expect(manualService.getArticlesByCategory).not.toHaveBeenCalled();

    const agency = response();
    await manualController.listAgencies({ params: { slug: 'labor' }, query: { limit: '1.5' } } as never, agency.res);
    expect(agency.status).toHaveBeenCalledWith(400);
    expect(manualService.getAgencies).not.toHaveBeenCalled();

    const notification = response();
    await notificationController.listNotifications({ userId: 'me', query: { cursor: '1' } } as never, notification.res);
    expect(notification.status).toHaveBeenCalledWith(400);
    expect(notificationService.getUserNotifications).not.toHaveBeenCalled();
  });
});
