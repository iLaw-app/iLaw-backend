import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCrisis, hotlinesFor } from '../src/services/ai.crisis';

// ── 순수 함수 ──────────────────────────────────────────────────

describe('detectCrisis / hotlinesFor', () => {
  it('고위험 키워드가 있으면 level=high', () => {
    expect(detectCrisis('남편이 아이를 때려요').level).toBe('high');
    expect(detectCrisis('협박당하고 있어요').level).toBe('high');
  });

  it('일반 상황은 level=none', () => {
    expect(detectCrisis('월급을 못 받았어요').level).toBe('none');
  });

  it('카테고리 전문 핫라인 + 공통 핫라인을 중복 없이 반환한다', () => {
    const lines = hotlinesFor(['child-abuse']);
    const phones = lines.map((l) => l.phone);
    expect(phones).toContain('112'); // 아동학대 신고 = 112 (공통 112와 중복 제거)
    expect(phones).toContain('1391'); // 아동보호전문기관
    expect(phones).toContain('119'); // 공통
    expect(new Set(phones).size).toBe(phones.length); // 중복 없음
  });

  it('알 수 없는 카테고리는 공통 핫라인만', () => {
    expect(hotlinesFor(['finance']).map((l) => l.phone)).toEqual(['112', '119', '1393']);
  });
});

// ── diagnose 위기 경로 ─────────────────────────────────────────

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

const ABUSE_CANDIDATE = {
  id: 7,
  question: '아동학대 신고 방법',
  summary: null,
  categorySlug: 'child-abuse',
  categoryName: '아동학대',
  score: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_CRISIS_ENABLED = 'true';
  delete process.env.AI_MULTITURN_ENABLED;
  retrieveCandidatesMock.mockResolvedValue([ABUSE_CANDIDATE]);
  prismaMock.manualArticle.findMany.mockResolvedValue([
    { id: 7, question: '아동학대 신고 방법', content: '신고 절차 안내...' },
  ]);
  prismaMock.agency.findMany.mockResolvedValue([
    { id: 100, region: '서울', name: '서울아동보호전문기관', role: '상담', contact: '02-000-0000' },
  ]);
});

describe('diagnose 위기 대응 (AI_CRISIS_ENABLED)', () => {
  it('위기 상황이면 status=crisis, suggestions 상단에 hotline→agency→manual 순으로 배치', async () => {
    openAiCreateMock
      .mockResolvedValueOnce(
        routerResponse({
          status: 'relevant',
          situationSummary: 'x',
          references: [{ type: 'manual', id: 7 }],
          isCrisis: true,
        }),
      )
      .mockResolvedValueOnce(textResponse('안전이 최우선이에요. 즉시 112에 신고하세요.'));

    const result = await diagnose('아이가 맞고 있어요', '홍길동', [], { region: '서울' });

    expect(result.status).toBe('crisis');
    const types = result.suggestions.map((s) => s.type);
    expect(types[0]).toBe('hotline');
    expect(types).toContain('agency');
    expect(types).toContain('manual');
    // hotline이 agency보다, agency가 manual보다 앞
    expect(types.indexOf('hotline')).toBeLessThan(types.indexOf('agency'));
    expect(types.indexOf('agency')).toBeLessThan(types.indexOf('manual'));

    const agency = result.suggestions.find((s) => s.type === 'agency');
    expect(agency).toMatchObject({ type: 'agency', label: '서울아동보호전문기관', contact: '02-000-0000', region: '서울' });
  });

  it('룰 키워드만으로도(라우터 isCrisis=false) 위기로 승격한다', async () => {
    openAiCreateMock
      .mockResolvedValueOnce(
        routerResponse({ status: 'relevant', situationSummary: 'x', references: [{ type: 'manual', id: 7 }], isCrisis: false }),
      )
      .mockResolvedValueOnce(textResponse('안내'));

    const result = await diagnose('아이를 때렸어요', '홍길동');

    expect(result.status).toBe('crisis');
  });

  it('플래그가 꺼져 있으면 위기 신호가 있어도 relevant로 처리(기존 계약 유지)', async () => {
    delete process.env.AI_CRISIS_ENABLED;
    openAiCreateMock
      .mockResolvedValueOnce(
        routerResponse({ status: 'relevant', situationSummary: 'x', references: [{ type: 'manual', id: 7 }], isCrisis: true }),
      )
      .mockResolvedValueOnce(textResponse('안내'));

    const result = await diagnose('아이가 맞고 있어요', '홍길동');

    expect(result.status).toBe('relevant');
    // 위기 아님 → 핫라인은 없지만, 기관 연락처는 항상 노출된다.
    expect(result.suggestions.some((s) => s.type === 'hotline')).toBe(false);
    expect(result.suggestions.some((s) => s.type === 'agency')).toBe(true);
    expect(result.suggestions.some((s) => s.type === 'manual')).toBe(true);
  });

  it('위기인데 생성 본문이 비면 안전 우선 폴백 문구를 반환한다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue([]); // content 없음 → 생성 스킵
    openAiCreateMock.mockResolvedValueOnce(
      routerResponse({ status: 'relevant', situationSummary: 'x', references: [{ type: 'manual', id: 7 }], isCrisis: true }),
    );

    const result = await diagnose('아이가 맞고 있어요', '홍길동');

    expect(result.status).toBe('crisis');
    expect(result.legalAdvice).toContain('112');
    // 핫라인은 여전히 노출
    expect(result.suggestions.some((s) => s.type === 'hotline')).toBe(true);
  });
});
