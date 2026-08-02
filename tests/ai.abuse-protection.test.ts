import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiCreateMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  aiChatHistory: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  aiDailyUsage: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  manualArticle: {
    findMany: vi.fn(),
  },
  searchSynonym: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return { chat: { completions: { create: openAiCreateMock } } };
  }),
}));
vi.mock('../src/prisma/client', () => ({ default: prismaMock }));

const ACCESS_SECRET = 'ai-abuse-protection-secret';
let app: Express;
let resetAiBurstLimits: () => void;

function authorization(userId = 'ai-user') {
  const token = jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: '5m' });
  return `Bearer ${token}`;
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = 'ai-refresh-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.AI_DAILY_REQUEST_LIMIT = '10';
  process.env.AI_BURST_REQUEST_LIMIT = '3';

  ({ resetAiBurstLimits } = await import('../src/services/ai.service'));
  app = (await import('../src/app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  resetAiBurstLimits();

  prismaMock.$transaction.mockImplementation(
    async (operation: (client: typeof prismaMock) => Promise<unknown>) => operation(prismaMock),
  );
  prismaMock.aiDailyUsage.upsert.mockResolvedValue({});
  prismaMock.aiDailyUsage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.user.findUnique.mockResolvedValue({ nickname: '테스터' });
  prismaMock.aiChatHistory.findMany.mockResolvedValue([]);
  prismaMock.aiChatHistory.create.mockResolvedValue({});
  prismaMock.manualArticle.findMany.mockResolvedValue([]);
  prismaMock.searchSynonym.findMany.mockResolvedValue([]);
  openAiCreateMock.mockResolvedValue({
    choices: [{ message: { content: '{"status":"unrelated"}' } }],
  });
});

describe('AI chat 비용 보호', () => {
  it('비로그인 요청을 401로 거부한다', async () => {
    const response = await request(app).post('/ai/chat').send({ message: '도와주세요' });

    expect(response.status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(openAiCreateMock).not.toHaveBeenCalled();
  });

  it('2,000자를 초과하는 메시지를 400으로 거부한다', async () => {
    const response = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '가'.repeat(2_001) });

    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(openAiCreateMock).not.toHaveBeenCalled();
  });

  it('일일 한도가 소진되면 429와 Retry-After를 반환하고 OpenAI를 호출하지 않는다', async () => {
    prismaMock.aiDailyUsage.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '임금 체불 문제입니다' });

    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(openAiCreateMock).not.toHaveBeenCalled();
    expect(prismaMock.aiDailyUsage.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'ai-user',
        requestCount: { lt: 10 },
      }),
      data: { requestCount: { increment: 1 } },
    });
  });

  it('정상 요청을 원자적으로 예약하고 응답 캐시를 금지한다', async () => {
    const response = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '임금 체불 문제입니다' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.status).toBe('unrelated');
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(openAiCreateMock).toHaveBeenCalledOnce();
    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ max_completion_tokens: 600 }),
      { timeout: 15_000 },
    );
  });

  it('분당 허용량을 넘으면 429를 반환한다', async () => {
    for (let index = 0; index < 3; index += 1) {
      const accepted = await request(app)
        .post('/ai/chat')
        .set('Authorization', authorization('burst-user'))
        .send({ message: `요청 ${index}` });
      expect(accepted.status).toBe(200);
    }

    const rejected = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization('burst-user'))
      .send({ message: '네 번째 요청' });

    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
    expect(openAiCreateMock).toHaveBeenCalledTimes(3);
  });

  it('OpenAI 호출 실패 시 일일 예약을 환불한다', async () => {
    openAiCreateMock.mockRejectedValueOnce(new Error('upstream unavailable'));

    const response = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization('refund-user'))
      .send({ message: '도와주세요' });

    expect(response.status).toBe(500);
    expect(prismaMock.aiDailyUsage.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'refund-user',
        requestCount: { gt: 0 },
      }),
      data: { requestCount: { decrement: 1 } },
    });
  });
});
