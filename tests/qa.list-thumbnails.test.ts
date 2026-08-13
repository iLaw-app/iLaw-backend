import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  qnAPost: {
    findMany: vi.fn(),
  },
}));

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.service', () => ({
  diagnose: vi.fn(),
  loadManualCache: vi.fn(),
}));

const ACCESS_SECRET = 'qa-list-thumbnails-test-secret';
let app: Express;

const POST = {
  id: 1,
  title: '질문',
  content: '본문',
  category: 'labor',
  status: 'pending',
  imageUrls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'],
  createdAt: new Date('2026-08-02T09:00:00.000Z'),
  author: { nickname: '익명' },
  _count: { scraps: 0 },
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = 'qa-list-thumbnails-refresh-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  app = (await import('../src/app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// 목록에 imageUrls가 없으면 클라이언트가 썸네일을 얻으려고 항목마다 상세를 다시
// 조회한다(40개 목록 → 41회 요청). 목록 응답에 반드시 포함되어야 한다.
describe('Q&A 목록 썸네일', () => {
  it('GET /qna 응답에 imageUrls가 포함된다', async () => {
    prismaMock.qnAPost.findMany.mockResolvedValue([POST]);

    const res = await request(app).get('/qna').expect(200);

    expect(res.body[0].imageUrls).toEqual(['https://cdn.test/a.png', 'https://cdn.test/b.png']);
  });

  it('GET /qna/mine 응답에 imageUrls가 포함된다', async () => {
    const { _count, ...mine } = POST;
    prismaMock.qnAPost.findMany.mockResolvedValue([mine]);

    const res = await request(app)
      .get('/qna/mine')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 'me' }, ACCESS_SECRET)}`)
      .expect(200);

    expect(res.body[0].imageUrls).toEqual(['https://cdn.test/a.png', 'https://cdn.test/b.png']);
  });

  it('이미지가 없는 글은 빈 배열을 준다', async () => {
    prismaMock.qnAPost.findMany.mockResolvedValue([{ ...POST, imageUrls: [] }]);

    const res = await request(app).get('/qna').expect(200);

    expect(res.body[0].imageUrls).toEqual([]);
  });
});
