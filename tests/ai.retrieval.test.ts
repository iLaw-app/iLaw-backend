import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  manualArticle: { findMany: vi.fn() },
  searchSynonym: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
const embedTextMock = vi.hoisted(() => vi.fn());

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.embeddings', () => ({
  embedText: embedTextMock,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

// synonyms 캐시가 테스트 간 새지 않도록 매번 비운다.
import { clearSynonymCache } from '../src/services/synonyms';
import { retrieveCandidates, fuseRRF } from '../src/services/ai.retrieval';

const ARTICLES = [
  {
    id: 1,
    question: '임금 체불 신고 방법',
    summary: '임금을 받지 못했을 때',
    content: '임금 체불은 고용노동부에 진정을 넣을 수 있습니다.',
    categoryId: 10,
    category: { slug: 'labor', name: '노동' },
  },
  {
    id: 2,
    question: '학교폭력 신고 절차',
    summary: null,
    content: '학교폭력은 학교전담경찰관에게 신고할 수 있습니다.',
    categoryId: 20,
    category: { slug: 'school-violence', name: '학교폭력' },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  clearSynonymCache();
  delete process.env.AI_HYBRID_SEARCH_ENABLED;
  prismaMock.searchSynonym.findMany.mockResolvedValue([]);
});

describe('fuseRRF', () => {
  it('여러 랭킹을 병합하고 두 목록 모두 상위인 항목을 가장 앞에 둔다', () => {
    const fused = fuseRRF([[3, 1, 2], [1, 4, 3]]);
    // id=1: rank0 + rank0, id=3: rank2 + rank2 → 1이 3보다 앞
    expect(fused[0].id).toBe(1);
    expect(fused.map((f) => f.id)).toEqual(expect.arrayContaining([1, 2, 3, 4]));
  });

  it('단일 목록은 순서를 보존한다', () => {
    expect(fuseRRF([[5, 6, 7]]).map((f) => f.id)).toEqual([5, 6, 7]);
  });
});

describe('retrieveCandidates (렉시컬)', () => {
  it('카테고리 무관하게 관련 매뉴얼을 점수순으로 추리고 content는 노출하지 않는다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue(ARTICLES);

    const candidates = await retrieveCandidates('임금 체불');

    expect(candidates.map((c) => c.id)).toEqual([1]);
    const [top] = candidates;
    expect(top).toMatchObject({ id: 1, categorySlug: 'labor', categoryName: '노동' });
    expect(top).not.toHaveProperty('content');
  });

  it('후보 풀을 넉넉히(take:150) 조회한다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue(ARTICLES);
    await retrieveCandidates('임금');
    expect(prismaMock.manualArticle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 150 }),
    );
  });

  it('일치하는 매뉴얼이 없으면 빈 배열을 반환한다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue([]);
    expect(await retrieveCandidates('관련없는질의')).toEqual([]);
  });

  it('하이브리드가 꺼져 있으면 임베딩/시맨틱 조회를 하지 않는다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue(ARTICLES);
    await retrieveCandidates('임금');
    expect(embedTextMock).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('retrieveCandidates (하이브리드)', () => {
  beforeEach(() => {
    process.env.AI_HYBRID_SEARCH_ENABLED = 'true';
    embedTextMock.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('렉시컬이 놓친 항목을 시맨틱으로 끌어와 융합한다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue(ARTICLES);
    // 렉시컬은 '임금'으로 id=1만 상위. 시맨틱은 id=2를 이웃으로 반환.
    prismaMock.$queryRaw.mockResolvedValue([{ id: 2 }]);

    const ids = (await retrieveCandidates('임금')).map((c) => c.id);

    expect(ids).toContain(1); // 렉시컬
    expect(ids).toContain(2); // 시맨틱이 추가로 끌어옴
    expect(embedTextMock).toHaveBeenCalledOnce();
  });

  it('시맨틱 조회 실패 시 렉시컬 단독으로 폴백한다', async () => {
    prismaMock.manualArticle.findMany.mockResolvedValue(ARTICLES);
    prismaMock.$queryRaw.mockRejectedValue(new Error('pgvector unavailable'));

    const ids = (await retrieveCandidates('임금 체불')).map((c) => c.id);

    expect(ids).toEqual([1]); // 렉시컬 결과만
  });
});
