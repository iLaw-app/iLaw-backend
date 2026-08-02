import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  qnAPost: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  qnAAnswer: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.service', () => ({
  diagnose: vi.fn(),
  loadManualCache: vi.fn(),
}));

const ACCESS_SECRET = 'qa-authorization-test-secret';
let app: Express;

function accessToken(userId: string) {
  return jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: '5m' });
}

function authorization(userId: string) {
  return `Bearer ${accessToken(userId)}`;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = 'qa-refresh-test-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  app = (await import('../src/app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();

  prismaMock.qnAPost.findUnique.mockResolvedValue({
    id: 1,
    authorId: 'question-author',
    title: '질문',
    content: '질문 내용',
    category: 'labor',
    status: 'pending',
    imageUrls: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    author: null,
    answer: null,
  });
  prismaMock.qnAAnswer.findUnique.mockResolvedValue({ lawyerId: 'lawyer-1' });
  prismaMock.qnAAnswer.create.mockResolvedValue({
    id: 10,
    postId: 1,
    lawyerId: 'lawyer-1',
    content: '답변 내용',
  });
  prismaMock.qnAAnswer.update.mockResolvedValue({
    id: 10,
    postId: 1,
    lawyerId: 'lawyer-1',
    content: '수정한 답변',
  });
  prismaMock.qnAPost.update.mockResolvedValue({ id: 1, status: 'answered' });
  prismaMock.user.update.mockResolvedValue({ id: 'lawyer-1', role: 'lawyer' });
  prismaMock.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
});

describe('Q&A 답변 권한', () => {
  it('비로그인 사용자의 답변 작성을 401로 거부한다', async () => {
    const response = await request(app)
      .post('/qa/1/answer')
      .send({ content: '답변 내용' });

    expect(response.status).toBe(401);
  });

  it('일반 사용자의 답변 작성을 403으로 거부한다', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    const response = await request(app)
      .post('/qa/1/answer')
      .set('Authorization', authorization('user-1'))
      .send({ content: '답변 내용' });

    expect(response.status).toBe(403);
    expect(prismaMock.qnAAnswer.create).not.toHaveBeenCalled();
  });

  it('일반 사용자의 기존 답변 수정을 403으로 거부한다', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    prismaMock.qnAAnswer.findUnique.mockResolvedValue({ lawyerId: 'user-1' });

    const response = await request(app)
      .patch('/qa/1/answer')
      .set('Authorization', authorization('user-1'))
      .send({ content: '수정한 답변' });

    expect(response.status).toBe(403);
    expect(prismaMock.qnAAnswer.update).not.toHaveBeenCalled();
  });

  it('lawyer의 답변 작성을 허용한다', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'lawyer-1', role: 'lawyer' });

    const response = await request(app)
      .post('/qa/1/answer')
      .set('Authorization', authorization('lawyer-1'))
      .send({ content: '답변 내용' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ postId: 1, lawyerId: 'lawyer-1' });
  });

  it('lawyer가 자신이 작성한 답변을 수정할 수 있다', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'lawyer-1', role: 'lawyer' });

    const response = await request(app)
      .patch('/qa/1/answer')
      .set('Authorization', authorization('lawyer-1'))
      .send({ content: '수정한 답변' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(prismaMock.qnAAnswer.update).toHaveBeenCalledWith({
      where: { postId: 1 },
      data: { content: '수정한 답변' },
    });
  });
});

describe('개발용 role API 제거', () => {
  it('비로그인 요청에 404를 반환한다', async () => {
    const response = await request(app)
      .patch('/auth/dev-role')
      .send({ role: 'lawyer' });

    expect(response.status).toBe(404);
  });

  it('로그인 요청에도 404를 반환한다', async () => {
    const response = await request(app)
      .patch('/auth/dev-role')
      .set('Authorization', authorization('user-1'))
      .send({ role: 'lawyer' });

    expect(response.status).toBe(404);
  });
});
