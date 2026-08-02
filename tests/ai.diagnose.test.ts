import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAiCreateMock = vi.hoisted(() => vi.fn());
const retrieveCandidatesMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  manualArticle: { findMany: vi.fn() },
  agency: { findMany: vi.fn() },
}));

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return { chat: { completions: { create: openAiCreateMock } } };
  }),
}));
vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.retrieval', () => ({ retrieveCandidates: retrieveCandidatesMock }));

import { diagnose } from '../src/services/ai.service';

function routerResponse(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}
function textResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
}

const LABOR_CANDIDATE = {
  id: 1,
  question: '임금 체불 신고 방법',
  summary: '임금을 못 받았을 때',
  categorySlug: 'labor',
  categoryName: '노동',
  score: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_MULTITURN_ENABLED;
  delete process.env.AI_CRISIS_ENABLED;
  retrieveCandidatesMock.mockResolvedValue([]);
  prismaMock.manualArticle.findMany.mockResolvedValue([]);
  prismaMock.agency.findMany.mockResolvedValue([]);
});

describe('diagnose 상태머신', () => {
  it('unrelated: 고정 안내를 반환하고 생성 단계를 호출하지 않는다', async () => {
    openAiCreateMock.mockResolvedValueOnce(routerResponse({ status: 'unrelated' }));

    const result = await diagnose('안녕하세요');

    expect(result.status).toBe('unrelated');
    expect(result.legalAdvice).toContain('법률 관련 상황만');
    expect(result.suggestions).toEqual([]);
    expect(result.chatEnded).toBe(true);
    expect(openAiCreateMock).toHaveBeenCalledOnce(); // 라우터만
  });

  it('router JSON 파싱 실패 시 안전 폴백(unrelated)으로 처리한다', async () => {
    openAiCreateMock.mockResolvedValueOnce(textResponse('완전히 JSON이 아님'));

    const result = await diagnose('임금 체불 당했어요');

    expect(result.status).toBe('unrelated');
    expect(result.legalAdvice).toContain('법률 관련 상황만');
    expect(openAiCreateMock).toHaveBeenCalledOnce();
  });

  it('relevant: 선택 매뉴얼 기반 안내와 suggestion을 반환한다', async () => {
    retrieveCandidatesMock.mockResolvedValue([LABOR_CANDIDATE]);
    openAiCreateMock
      .mockResolvedValueOnce(
        routerResponse({
          status: 'relevant',
          situationSummary: '홍길동님은 임금을 받지 못했습니다.',
          references: [{ type: 'manual', id: 1 }],
          isCrisis: false,
        }),
      )
      .mockResolvedValueOnce(textResponse('정말 힘드셨겠어요. 고용노동부에 진정을 넣을 수 있어요.'));
    prismaMock.manualArticle.findMany.mockResolvedValue([
      { id: 1, question: '임금 체불 신고 방법', content: '진정 절차...' },
    ]);

    const result = await diagnose('임금을 못 받았어요', '홍길동');

    expect(result.status).toBe('relevant');
    expect(result.situationSummary).toContain('홍길동님은');
    expect(result.legalAdvice).toContain('고용노동부');
    expect(result.suggestions).toEqual([{ type: 'manual', id: 1, label: '임금 체불 신고 방법' }]);
    expect(result.chatEnded).toBe(true);
    expect(openAiCreateMock).toHaveBeenCalledTimes(2);
  });

  it('라우터가 하나도 못 고르면 매뉴얼을 억지로 채우지 않는다', async () => {
    retrieveCandidatesMock.mockResolvedValue([LABOR_CANDIDATE]);
    openAiCreateMock.mockResolvedValueOnce(
      routerResponse({ status: 'relevant', situationSummary: 'x', references: [] }),
    );

    const result = await diagnose('상황 설명', '홍길동');

    // 틀린 매뉴얼을 밀지 않고, 매뉴얼 없이 안전 폴백 문구를 반환한다.
    expect(result.status).toBe('relevant');
    expect(result.suggestions.some((s) => s.type === 'manual')).toBe(false);
    expect(result.legalAdvice).toContain('조금 더 구체적으로');
    expect(openAiCreateMock).toHaveBeenCalledOnce(); // 생성(step2) 스킵
  });

  it('후보 밖 환각 ID는 제외하고, 안내가 비면 고정 폴백 문구로 대체한다', async () => {
    retrieveCandidatesMock.mockResolvedValue([LABOR_CANDIDATE]);
    openAiCreateMock.mockResolvedValueOnce(
      routerResponse({ status: 'relevant', situationSummary: 'x', references: [{ type: 'manual', id: 99 }] }),
    );
    // 폴백 채택 id=1이지만 content 조회가 비어 생성 스킵 → 폴백 문구
    prismaMock.manualArticle.findMany.mockResolvedValue([]);

    const result = await diagnose('상황', '홍길동');

    expect(result.status).toBe('relevant');
    expect(result.suggestions.map((s) => (s.type === 'manual' ? s.id : -1))).not.toContain(99);
    expect(result.legalAdvice).toContain('조금 더 구체적으로');
    expect(openAiCreateMock).toHaveBeenCalledOnce(); // 생성 스킵
  });

  describe('멀티턴 활성화(AI_MULTITURN_ENABLED=true)', () => {
    beforeEach(() => {
      process.env.AI_MULTITURN_ENABLED = 'true';
    });

    it('needs_clarification: 되묻는 질문과 chatEnded=false를 반환한다', async () => {
      openAiCreateMock.mockResolvedValueOnce(
        routerResponse({
          status: 'needs_clarification',
          situationSummary: '',
          references: [],
          followUpQuestion: '어떤 상황인지 조금 더 자세히 알려주실 수 있을까요?',
        }),
      );

      const result = await diagnose('도와주세요');

      expect(result.status).toBe('needs_clarification');
      expect(result.followUpQuestion).toContain('자세히');
      expect(result.chatEnded).toBe(false);
      expect(openAiCreateMock).toHaveBeenCalledOnce(); // 생성 스킵
    });

    it('crisis: isCrisis=true면 상태를 crisis로 승격한다', async () => {
      process.env.AI_CRISIS_ENABLED = 'true';
      retrieveCandidatesMock.mockResolvedValue([
        { id: 7, question: '아동학대 신고', summary: null, categorySlug: 'child-abuse', categoryName: '아동학대', score: 3 },
      ]);
      openAiCreateMock
        .mockResolvedValueOnce(
          routerResponse({
            status: 'relevant',
            situationSummary: 'x',
            references: [{ type: 'manual', id: 7 }],
            isCrisis: true,
          }),
        )
        .mockResolvedValueOnce(textResponse('안전이 가장 중요해요. 즉시 112에 신고하세요.'));
      prismaMock.manualArticle.findMany.mockResolvedValue([
        { id: 7, question: '아동학대 신고', content: '신고 절차...' },
      ]);

      const result = await diagnose('아이가 맞고 있어요');

      expect(result.status).toBe('crisis');
      expect(result.chatEnded).toBe(false);
    });
  });

  it('멀티턴 비활성 시 needs_clarification/crisis 대신 relevant로 처리한다', async () => {
    // 멀티턴 off에서 라우터에 clarification 옵션이 없으므로 relevant로 응답
    retrieveCandidatesMock.mockResolvedValue([LABOR_CANDIDATE]);
    openAiCreateMock
      .mockResolvedValueOnce(
        routerResponse({ status: 'relevant', situationSummary: 'x', references: [{ type: 'manual', id: 1 }], isCrisis: true }),
      )
      .mockResolvedValueOnce(textResponse('안내'));
    prismaMock.manualArticle.findMany.mockResolvedValue([{ id: 1, question: '임금 체불 신고 방법', content: 'c' }]);

    const result = await diagnose('상황', '홍길동');

    // isCrisis=true여도 멀티턴 off면 crisis 승격/ chatEnded=false 하지 않음
    expect(result.status).toBe('relevant');
    expect(result.chatEnded).toBe(true);
  });
});
