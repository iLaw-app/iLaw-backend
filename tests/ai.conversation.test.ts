import type { Express } from 'express';
import { EventEmitter } from 'node:events';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiCreateMock = vi.hoisted(() => vi.fn());
const retrieveCandidatesMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  manualArticle: { findMany: vi.fn() },
  aiChatHistory: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  aiConversation: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  aiDailyUsage: { upsert: vi.fn(), updateMany: vi.fn() },
  agency: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return { chat: { completions: { create: openAiCreateMock } } };
  }),
}));
vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.retrieval', () => ({ retrieveCandidates: retrieveCandidatesMock }));
vi.mock('../src/middlewares/logging', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/middlewares/logging')>();
  return { ...original, logger: { info: vi.fn(), error: loggerErrorMock } };
});

const ACCESS_SECRET = 'ai-conversation-secret';
let app: Express;
let resetAiBurstLimits: () => void;

function authorization(userId = 'convo-user') {
  return `Bearer ${jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: '5m' })}`;
}
function routerResponse(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}
function textResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
}

const LABOR_CANDIDATE = {
  id: 1,
  question: '임금 체불 신고 방법',
  summary: null,
  categorySlug: 'labor',
  categoryName: '노동',
  score: 2,
};

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = 'ai-refresh-secret';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.AI_MULTITURN_ENABLED = 'true';

  ({ resetAiBurstLimits } = await import('../src/services/ai.service'));
  app = (await import('../src/app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  resetAiBurstLimits();
  process.env.AI_MULTITURN_ENABLED = 'true';

  prismaMock.$transaction.mockImplementation(
    async (op: (client: typeof prismaMock) => Promise<unknown>) => op(prismaMock),
  );
  prismaMock.aiDailyUsage.upsert.mockResolvedValue({});
  prismaMock.aiDailyUsage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.user.findUnique.mockResolvedValue({ nickname: '테스터', region: '서울' });
  prismaMock.manualArticle.findMany.mockResolvedValue([]);
  prismaMock.aiChatHistory.findMany.mockResolvedValue([]);
  prismaMock.aiChatHistory.create.mockResolvedValue({});
  prismaMock.aiChatHistory.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.aiConversation.create.mockResolvedValue({ id: 'conv-1', lastStatus: null, title: null });
  prismaMock.aiConversation.findFirst.mockResolvedValue(null);
  prismaMock.aiConversation.findMany.mockResolvedValue([]);
  prismaMock.aiConversation.update.mockResolvedValue({});
  prismaMock.agency.findMany.mockResolvedValue([]);
  retrieveCandidatesMock.mockResolvedValue([]);
  loggerErrorMock.mockClear();
});

describe('멀티턴 대화 스레드', () => {
  it('deferred persistence는 response finish 전에는 시작하지 않고 finish 뒤 실패를 기록한다', async () => {
    const { startAiBackgroundTasksAfterFinish } = await import('../src/controllers/ai.controller');
    const response = new EventEmitter();
    const start = vi.fn(() => Promise.reject(new Error('SQL SELECT secret request text')));

    startAiBackgroundTasksAfterFinish(response, [{
      start,
      context: {
        event: 'ai_history_persistence_failed',
        requestId: 'deferred-request',
        userId: 'convo-user',
      },
    }]);

    expect(start).not.toHaveBeenCalled();
    response.emit('finish');
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(loggerErrorMock).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ai_history_persistence_failed',
      requestId: 'deferred-request',
      errorName: 'Error',
      errorCategory: 'background_task_failure',
    })));
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('SQL SELECT secret request text');
  });

  it('conversationId 없이 요청하면 새 대화를 만들고 되묻기를 반환한다', async () => {
    openAiCreateMock.mockResolvedValueOnce(
      routerResponse({
        status: 'needs_clarification',
        situationSummary: '',
        references: [],
        followUpQuestion: '어떤 상황인지 조금 더 알려주실 수 있을까요?',
      }),
    );

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '도와주세요' });

    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe('conv-1');
    expect(res.body.status).toBe('needs_clarification');
    expect(res.body.chatEnded).toBe(false);
    expect(res.body.followUpQuestion).toContain('알려주실');

    expect(prismaMock.aiConversation.create).toHaveBeenCalledOnce();
    // 되묻기 턴도 대화 문맥 복원을 위해 저장한다.
    expect(prismaMock.aiChatHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conversationId: 'conv-1', status: 'needs_clarification' }),
      }),
    );
    expect(prismaMock.aiConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: 'needs_clarification' }) }),
    );
  });

  it('conversationId로 이어가면 해당 대화 히스토리를 로드하고 relevant로 전이한다', async () => {
    prismaMock.aiConversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      lastStatus: 'needs_clarification',
      title: null,
    });
    retrieveCandidatesMock.mockResolvedValue([LABOR_CANDIDATE]);
    prismaMock.manualArticle.findMany.mockResolvedValue([
      { id: 1, question: '임금 체불 신고 방법', content: '고용노동부에 진정 절차...' },
    ]);
    prismaMock.aiChatHistory.findMany.mockResolvedValue([
      { question: '도와주세요', legalAdvice: '어떤 상황인지 조금 더 알려주실 수 있을까요?' },
    ]);
    openAiCreateMock
      .mockResolvedValueOnce(
        routerResponse({
          status: 'relevant',
          situationSummary: '테스터님은 임금을 받지 못했습니다.',
          references: [{ type: 'manual', id: 1 }],
          isCrisis: false,
        }),
      )
      .mockResolvedValueOnce(textResponse('정말 힘드셨겠어요. 고용노동부에 진정을 넣을 수 있어요.'));

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '2년째 일했는데 3개월치를 못 받았어요', conversationId: 'conv-1' });

    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe('conv-1');
    expect(res.body.status).toBe('relevant');
    expect(res.body.legalAdvice).toContain('고용노동부');

    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled();
    // 전역이 아닌 해당 대화 스레드의 히스토리를 로드해야 한다.
    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'conv-1', userId: 'convo-user' } }),
    );
  });

  it('존재하지 않는 conversationId는 404를 반환하고 쿼터를 환불하며 OpenAI를 호출하지 않는다', async () => {
    prismaMock.aiConversation.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '이어서 질문', conversationId: 'ghost' });

    expect(res.status).toBe(404);
    expect(openAiCreateMock).not.toHaveBeenCalled();
    // 일일 쿼터 환불(decrement) 호출
    expect(prismaMock.aiDailyUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { requestCount: { decrement: 1 } } }),
    );
  });

  it('conversationId 타입과 길이를 AI 호출 전에 검증한다', async () => {
    const wrongType = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '이어서 질문', conversationId: 123 });
    const tooLong = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .send({ message: '이어서 질문', conversationId: 'c'.repeat(129) });

    expect(wrongType.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(openAiCreateMock).not.toHaveBeenCalled();
  });

  it('AI 요청 실패의 운영 로그는 원본 오류/SQL/request text 없이 분류만 남긴다', async () => {
    openAiCreateMock.mockRejectedValueOnce(new Error('SELECT secret FROM request_payload'));

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .set('x-request-id', 'ai-failure-request')
      .send({ message: '민감한 요청 본문' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Internal server error', requestId: 'ai-failure-request' });
    expect(loggerErrorMock).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ai_request_failed',
      requestId: 'ai-failure-request',
      errorName: 'Error',
      errorCategory: 'request_execution',
    }));
    const logs = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logs).not.toContain('SELECT secret');
    expect(logs).not.toContain('민감한 요청 본문');
    expect(logs).not.toContain('stack');
  });

  it('AI DB 조회 실패도 원본 SQL 없이 동일한 500 계약으로 변환한다', async () => {
    prismaMock.aiConversation.findMany.mockRejectedValueOnce(
      new Error('SELECT private_column FROM ai_conversations'),
    );

    const res = await request(app)
      .get('/ai/conversations')
      .set('Authorization', authorization())
      .set('x-request-id', 'ai-db-failure-request');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      message: 'Internal server error',
      requestId: 'ai-db-failure-request',
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ai_request_failed',
      requestId: 'ai-db-failure-request',
      errorName: 'Error',
      errorCategory: 'request_execution',
    }));
    const logs = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logs).not.toContain('SELECT private_column');
    expect(logs).not.toContain('stack');
  });

  it('응답 후 히스토리 저장 실패를 요청 문맥과 함께 기록하되 성공 응답을 유지한다', async () => {
    openAiCreateMock.mockResolvedValueOnce(
      routerResponse({
        status: 'needs_clarification',
        situationSummary: '',
        references: [],
        followUpQuestion: '상황을 더 알려주세요.',
      }),
    );
    prismaMock.aiChatHistory.create.mockRejectedValueOnce(new Error('history unavailable'));

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .set('x-request-id', 'ai-save-request')
      .send({ message: '도와주세요' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('needs_clarification');
    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.objectContaining({
        event: 'ai_history_persistence_failed',
        requestId: 'ai-save-request',
        userId: 'convo-user',
        conversationId: 'conv-1',
      }));
    });
  });

  it('응답 후 대화 메타 갱신 실패도 별도 이벤트로 기록한다', async () => {
    openAiCreateMock.mockResolvedValueOnce(
      routerResponse({ status: 'unrelated', situationSummary: '', references: [] }),
    );
    prismaMock.aiConversation.update.mockRejectedValueOnce(new Error('conversation unavailable'));

    const res = await request(app)
      .post('/ai/chat')
      .set('Authorization', authorization())
      .set('x-request-id', 'ai-conversation-save')
      .send({ message: '안녕하세요' });

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.objectContaining({
        event: 'ai_conversation_persistence_failed',
        requestId: 'ai-conversation-save',
      }));
    });
  });

  it('GET /ai/conversations 로 대화 목록을 안정적인 최근순으로 반환한다', async () => {
    prismaMock.aiConversation.findMany.mockResolvedValue([
      { id: 'conv-1', title: '임금 체불', status: 'open', lastStatus: 'relevant', createdAt: new Date(0), updatedAt: new Date(0) },
    ]);

    const res = await request(app).get('/ai/conversations').set('Authorization', authorization());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('conv-1');
    expect(res.headers['x-pagination-limit']).toBe('20');
    expect(res.headers['x-next-cursor']).toBeUndefined();
    expect(prismaMock.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 21 }),
    );
  });

  it('대화 목록 cursor 소유권과 현재 updatedAt 경계를 조회해 keyset 페이지와 헤더를 반환한다', async () => {
    const boundary = new Date('2026-01-02T03:04:05.000Z');
    prismaMock.aiConversation.findFirst.mockResolvedValueOnce({ id: 'conv-before', updatedAt: boundary });
    prismaMock.aiConversation.findMany.mockResolvedValueOnce([
      { id: 'conv-3' }, { id: 'conv-2' }, { id: 'conv-extra' },
    ]);

    const bounded = await request(app)
      .get('/ai/conversations?limit=2&cursor=conv-before')
      .set('Authorization', authorization());

    expect(bounded.status).toBe(200);
    expect(bounded.body).toEqual([{ id: 'conv-3' }, { id: 'conv-2' }]);
    expect(bounded.headers['x-next-cursor']).toBe('conv-2');
    expect(bounded.headers['x-pagination-limit']).toBe('2');
    expect(bounded.headers['access-control-expose-headers']).toContain('X-Next-Cursor');
    expect(prismaMock.aiConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      where: {
        userId: 'convo-user',
        OR: [
          { updatedAt: { lt: boundary } },
          { updatedAt: boundary, id: { lt: 'conv-before' } },
        ],
      },
    }));
  });

  it('타 사용자 및 존재하지 않는 대화 cursor에 동일한 오류를 반환한다', async () => {
    prismaMock.aiConversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const foreign = await request(app)
      .get('/ai/conversations?cursor=other-users-conversation')
      .set('Authorization', authorization());
    const missing = await request(app)
      .get('/ai/conversations?cursor=missing')
      .set('Authorization', authorization());

    expect(foreign.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(foreign.body).toEqual({ error: 'invalid cursor' });
    expect(missing.body).toEqual(foreign.body);
  });

  it('대화 목록 limit을 검증한다', async () => {
    const oversized = await request(app)
      .get('/ai/conversations?limit=101')
      .set('Authorization', authorization());
    const repeated = await request(app)
      .get('/ai/conversations?limit=10&limit=20')
      .set('Authorization', authorization());

    expect(oversized.status).toBe(400);
    expect(repeated.status).toBe(400);
  });

  it('히스토리 cursor가 현재 사용자 소유인지 확인하고 createdAt/id keyset을 사용한다', async () => {
    const defaultPage = await request(app).get('/ai/history').set('Authorization', authorization());
    expect(defaultPage.status).toBe(200);
    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 21,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));

    const boundary = new Date('2026-02-03T04:05:06.000Z');
    prismaMock.aiChatHistory.findFirst.mockResolvedValueOnce({ id: 42, createdAt: boundary });
    const nextPage = await request(app)
      .get('/ai/history?limit=7&cursor=42')
      .set('Authorization', authorization());
    expect(nextPage.status).toBe(200);
    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 8,
      where: {
        userId: 'convo-user',
        OR: [
          { createdAt: { gt: boundary } },
          { createdAt: boundary, id: { gt: 42 } },
        ],
      },
    }));

    prismaMock.aiChatHistory.findFirst.mockResolvedValueOnce(null);
    const foreign = await request(app)
      .get('/ai/history?cursor=99')
      .set('Authorization', authorization());
    expect(foreign.status).toBe(400);
    expect(foreign.body).toEqual({ error: 'invalid cursor' });

    const invalidCursor = await request(app)
      .get('/ai/history?cursor=not-an-integer')
      .set('Authorization', authorization());
    expect(invalidCursor.status).toBe(400);
  });

  it('대화 상세 메시지 cursor는 해당 사용자와 대화 소유만 허용하고 안정적인 keyset을 사용한다', async () => {
    const boundary = new Date('2026-03-04T05:06:07.000Z');
    prismaMock.aiConversation.findFirst.mockResolvedValue({ id: 'conv-1', title: null });
    prismaMock.aiChatHistory.findFirst.mockResolvedValueOnce({ id: 3, createdAt: boundary });
    prismaMock.aiChatHistory.findMany.mockResolvedValueOnce([]);
    const page = await request(app)
      .get('/ai/conversations/conv-1?limit=9&cursor=3')
      .set('Authorization', authorization());

    expect(page.status).toBe(200);
    expect(prismaMock.aiChatHistory.findFirst).toHaveBeenCalledWith({
      where: { id: 3, userId: 'convo-user', conversationId: 'conv-1' },
      select: { id: true, createdAt: true },
    });
    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
        userId: 'convo-user',
        conversationId: 'conv-1',
        OR: [
          { createdAt: { gt: boundary } },
          { createdAt: boundary, id: { gt: 3 } },
        ],
      },
    }));

    prismaMock.aiChatHistory.findFirst.mockResolvedValueOnce(null);
    const foreignConversationCursor = await request(app)
      .get('/ai/conversations/conv-1?cursor=4')
      .set('Authorization', authorization());
    expect(foreignConversationCursor.status).toBe(400);
    expect(foreignConversationCursor.body).toEqual({ error: 'invalid cursor' });

    const invalidId = await request(app)
      .get(`/ai/conversations/${'c'.repeat(129)}`)
      .set('Authorization', authorization());
    expect(invalidId.status).toBe(400);
  });

  it('대화 cursor의 updatedAt이 변하면 조회 시점의 새 경계를 사용하는 live-order 정책을 따른다', async () => {
    const mutatedBoundary = new Date('2026-04-05T06:07:08.000Z');
    prismaMock.aiConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-moving',
      updatedAt: mutatedBoundary,
    });

    await request(app)
      .get('/ai/conversations?cursor=conv-moving')
      .set('Authorization', authorization());

    expect(prismaMock.aiConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { updatedAt: { lt: mutatedBoundary } },
          { updatedAt: mutatedBoundary, id: { lt: 'conv-moving' } },
        ],
      }),
    }));
  });
});
