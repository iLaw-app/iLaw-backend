import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/prisma/client', () => ({ default: {} }));
vi.mock('../src/services/ai.service', () => ({
  diagnose: vi.fn(),
  loadManualCache: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'naver-removal-access-secret';
  process.env.JWT_REFRESH_SECRET = 'naver-removal-refresh-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  app = (await import('../src/app')).default;
});

describe('네이버 로그인 제거', () => {
  it('네이버 OAuth 시작 경로가 존재하지 않는다', async () => {
    const response = await request(app).get('/auth/naver');

    expect(response.status).toBe(404);
  });

  it('네이버 OAuth 콜백 경로가 존재하지 않는다', async () => {
    const response = await request(app).get('/auth/naver/callback');

    expect(response.status).toBe(404);
  });

  it('네이버 SDK 토큰 로그인 경로가 존재하지 않는다', async () => {
    const response = await request(app)
      .post('/auth/naver/token')
      .send({ accessToken: 'unused-token' });

    expect(response.status).toBe(404);
  });
});
