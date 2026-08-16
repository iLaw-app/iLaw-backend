import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiCreateMock = vi.hoisted(() => vi.fn());
const retrieveCandidatesMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  manualArticle: { findMany: vi.fn() },
  aiChatHistory: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
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
      expect.objectContaining({ where: { conversationId: 'conv-1' } }),
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

  it('GET /ai/conversations 로 대화 목록을 최근순으로 반환한다', async () => {
    prismaMock.aiConversation.findMany.mockResolvedValue([
      { id: 'conv-1', title: '임금 체불', status: 'open', lastStatus: 'relevant', createdAt: new Date(0), updatedAt: new Date(0) },
    ]);

    const res = await request(app).get('/ai/conversations').set('Authorization', authorization());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('conv-1');
    expect(prismaMock.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' }, take: 20 }),
    );
  });

  it('대화 목록 limit/cursor를 검증하고 Prisma 조회를 100개 이하로 제한한다', async () => {
    const bounded = await request(app)
      .get('/ai/conversations?limit=100&cursor=conv-before')
      .set('Authorization', authorization());

    expect(bounded.status).toBe(200);
    expect(prismaMock.aiConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      cursor: { id: 'conv-before' },
      skip: 1,
    }));

    const oversized = await request(app)
      .get('/ai/conversations?limit=101')
      .set('Authorization', authorization());
    const repeated = await request(app)
      .get('/ai/conversations?limit=10&limit=20')
      .set('Authorization', authorization());

    expect(oversized.status).toBe(400);
    expect(repeated.status).toBe(400);
  });

  it('히스토리 목록도 기본/요청 limit과 정수 cursor로 bounded query를 수행한다', async () => {
    const defaultPage = await request(app).get('/ai/history').set('Authorization', authorization());
    expect(defaultPage.status).toBe(200);
    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));

    const nextPage = await request(app)
      .get('/ai/history?limit=7&cursor=42')
      .set('Authorization', authorization());
    expect(nextPage.status).toBe(200);
    expect(prismaMock.aiChatHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 7,
      cursor: { id: 42 },
      skip: 1,
    }));

    const invalidCursor = await request(app)
      .get('/ai/history?cursor=not-an-integer')
      .set('Authorization', authorization());
    expect(invalidCursor.status).toBe(400);
  });

  it('대화 상세 메시지도 limit/cursor로 제한하고 잘못된 id를 거부한다', async () => {
    prismaMock.aiConversation.findFirst.mockResolvedValue({ id: 'conv-1', messages: [] });
    const page = await request(app)
      .get('/ai/conversations/conv-1?limit=9&cursor=3')
      .set('Authorization', authorization());

    expect(page.status).toBe(200);
    expect(prismaMock.aiConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        messages: expect.objectContaining({ take: 9, cursor: { id: 3 }, skip: 1 }),
      }),
    }));

    const invalidId = await request(app)
      .get(`/ai/conversations/${'c'.repeat(129)}`)
      .set('Authorization', authorization());
    expect(invalidId.status).toBe(400);
  });
});
