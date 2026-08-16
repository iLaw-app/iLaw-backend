import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  qnAPost: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  qnAAnswer: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  communityPost: { findUnique: vi.fn(), create: vi.fn() },
  communityComment: { findUnique: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.service', () => ({ diagnose: vi.fn(), loadManualCache: vi.fn() }));
vi.mock('../src/services/moderation.service', () => ({ moderateAndBlind: vi.fn(), isFlaggedByAI: vi.fn() }));
vi.mock('../src/services/notification.service', () => ({
  createNotification: vi.fn(),
  createNotificationsForLawyers: vi.fn().mockResolvedValue(undefined),
}));

const ACCESS_SECRET = 'profanity-api-test-secret';
let app: Express;

function authorization(userId: string) {
  return `Bearer ${jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: '5m' })}`;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = 'profanity-refresh-test-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  app = (await import('../src/app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: 'lawyer-1', role: 'lawyer' });
  prismaMock.qnAPost.findUnique.mockResolvedValue({ id: 1, answer: null });
  prismaMock.qnAPost.create.mockResolvedValue({ id: 5, title: '제목', content: '본문' });
  prismaMock.qnAAnswer.create.mockResolvedValue({ id: 10, postId: 1, lawyerId: 'lawyer-1', content: '답변' });
  prismaMock.communityPost.findUnique.mockResolvedValue({ id: 1, authorId: 'author-1', status: 'visible' });
  prismaMock.$transaction.mockImplementation(async (operations: Promise<unknown>[] | ((tx: typeof prismaMock) => unknown)) =>
    typeof operations === 'function' ? operations(prismaMock) : Promise.all(operations));
});

describe('QnA 금칙어 차단', () => {
  it('질문 제목/본문에 금칙어가 있으면 400 + 필드별 위치를 돌려주고 저장하지 않는다', async () => {
    const response = await request(app)
      .post('/qna')
      .set('Authorization', authorization('user-1'))
      .send({ title: '이 시발 상황', content: '정상 본문', category: 'school' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: '부적절한 표현이 포함되어 있어 등록할 수 없습니다.',
      code: 'profanity_blocked',
      fields: { title: [{ word: '시발', start: 2, end: 4 }] },
    });
    expect(prismaMock.qnAPost.create).not.toHaveBeenCalled();
  });

  it('정상 질문은 201로 등록된다', async () => {
    const response = await request(app)
      .post('/qna')
      .set('Authorization', authorization('user-1'))
      .send({ title: '학교폭력 신고', content: '당시 발생한 일입니다', category: 'school' });

    expect(response.status).toBe(201);
    expect(prismaMock.qnAPost.create).toHaveBeenCalled();
  });

  it('변호사 답변에도 금칙어가 있으면 400으로 차단한다', async () => {
    const response = await request(app)
      .post('/qna/1/answer')
      .set('Authorization', authorization('lawyer-1'))
      .send({ content: '병신 같은 질문' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('profanity_blocked');
    expect(response.body.fields.content[0]).toEqual({ word: '병신', start: 0, end: 2 });
    expect(prismaMock.qnAAnswer.create).not.toHaveBeenCalled();
  });

  it('답변 수정에도 금칙어가 있으면 400으로 차단한다', async () => {
    const response = await request(app)
      .patch('/qna/1/answer')
      .set('Authorization', authorization('lawyer-1'))
      .send({ content: 'ㅅㅂ 수정' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('profanity_blocked');
    expect(prismaMock.qnAAnswer.update).not.toHaveBeenCalled();
  });
});

describe('커뮤니티 금칙어 응답 본문', () => {
  it('댓글 400 응답에 code 와 fields 가 포함된다', async () => {
    const response = await request(app)
      .post('/community/1/comments')
      .set('Authorization', authorization('user-1'))
      .send({ content: '너 개-새-끼야' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: '부적절한 표현이 포함되어 있어 등록할 수 없습니다.',
      code: 'profanity_blocked',
      fields: { content: [{ word: '개-새-끼', start: 2, end: 7 }] },
    });
    expect(prismaMock.communityComment.create).not.toHaveBeenCalled();
  });

  it('게시글 400 응답에 제목/본문 각각의 위치가 담긴다', async () => {
    const response = await request(app)
      .post('/community')
      .set('Authorization', authorization('user-1'))
      .send({ title: '시발 제목', content: '본문 sibal' });

    expect(response.status).toBe(400);
    expect(response.body.fields).toEqual({
      title: [{ word: '시발', start: 0, end: 2 }],
      content: [{ word: 'sibal', start: 3, end: 8 }],
    });
  });
});

describe('POST /moderation/check', () => {
  it('필드별 매치 위치를 돌려준다 (인증 불필요)', async () => {
    const response = await request(app)
      .post('/moderation/check')
      .send({ fields: { title: '안녕', content: '이거 진짜 ㅅㅂ 짜증' } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      blocked: true,
      fields: { content: [{ word: 'ㅅㅂ', start: 6, end: 8 }] },
    });
  });

  it('금칙어가 없으면 blocked=false, fields={}', async () => {
    const response = await request(app)
      .post('/moderation/check')
      .send({ fields: { content: '당시 발생한 일입니다' } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ blocked: false, fields: {} });
  });

  it('잘못된 본문은 400', async () => {
    expect((await request(app).post('/moderation/check').send({})).status).toBe(400);
    expect((await request(app).post('/moderation/check').send({ fields: [] })).status).toBe(400);
    expect((await request(app).post('/moderation/check').send({ fields: { a: 1 } })).status).toBe(400);
    expect((await request(app).post('/moderation/check').send({ fields: {} })).status).toBe(400);
  });
});

describe('/moderation/check 는 전역 rate limit 을 소모하지 않는다', () => {
  it('RateLimit-Limit 헤더가 전역 한도가 아닌 자체 한도를 가리킨다', async () => {
    const check = await request(app).post('/moderation/check').send({ fields: { content: '안녕' } });
    const other = await request(app).get('/community?limit=1');
    expect(check.headers['ratelimit-limit']).toBe(String(process.env.MODERATION_CHECK_MAX ?? 600));
    expect(check.headers['ratelimit-limit']).not.toBe(other.headers['ratelimit-limit']);
  });

  it('CORS 헤더가 붙는다 (허용 origin)', async () => {
    const response = await request(app)
      .post('/moderation/check')
      .set('Origin', 'http://localhost:5173')
      .send({ fields: { content: '안녕' } });
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });
});
