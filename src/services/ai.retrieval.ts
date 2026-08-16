import prisma from '../prisma/client';
import { rankManuals } from './manual.service';
import { EMBED_VERSION, embedText, toVectorLiteral } from './ai.embeddings';
import { logger } from '../middlewares/logging';
import { safeAiErrorFields } from './ai.logging';

// A single manual surfaced by retrieval, trimmed to what the router LLM needs
// to decide (title + summary + category). `content` is intentionally omitted —
// only the finally-selected manuals get their full body loaded in step 2.
export interface Candidate {
  id: number;
  question: string;
  summary: string | null;
  categorySlug: string;
  categoryName: string;
  score: number;
}

// 라우터에게 보여줄 후보 수. 골든 케이스 기준 recall@8 0.973 → recall@12 0.991
// (text-embedding-3-large). 후보 4개 추가는 라우터 입력 ~250토큰 수준이다.
export const DEFAULT_TOP_K = 12;
const CANDIDATE_POOL = 150; // rows pulled from DB before ranking
const SEMANTIC_LIMIT = 20; // semantic neighbours fetched before fusion

// RRF 가중치. 렉시컬 랭커는 질의 전체 문자열/동의어 그룹의 substring 일치라서
// 구어체 문장에서는 신호가 약하고, "직장"처럼 한 단어가 노동 매뉴얼 전체를 끌어오는
// 잡음도 낸다. 시맨틱을 주 신호로, 렉시컬은 절반 가중치의 보조(+임베딩 부재 시 폴백)로 둔다.
const LEXICAL_WEIGHT = 0.5;
const SEMANTIC_WEIGHT = 1;

function hybridEnabled(): boolean {
  return process.env.AI_HYBRID_SEARCH_ENABLED === 'true';
}

// Reciprocal Rank Fusion: merge several ranked id-lists into one, robust to the
// two rankers' incomparable score scales. Optional per-list weights. Pure —
// exported for unit testing.
export function fuseRRF(
  rankedLists: number[][],
  k = 60,
  weights: number[] = [],
): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  rankedLists.forEach((list, listIndex) => {
    const weight = weights[listIndex] ?? 1;
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + index + 1));
    });
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// Semantic neighbours via pgvector cosine distance. Returns ids in similarity
// order. Only rows embedded with the CURRENT embedding version are eligible —
// a query vector from model A against document vectors from model B is noise.
// Any failure (no embeddings backfilled yet, embedding API down, pgvector
// absent) degrades to [] so the caller falls back to lexical-only ranking.
async function semanticSearch(query: string, limit: number): Promise<number[]> {
  try {
    const embedding = await embedText(query);
    const versionPrefix = `${EMBED_VERSION}:%`;
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT "id"
      FROM "ManualArticle"
      WHERE "embedding" IS NOT NULL
        AND "embedInputHash" LIKE ${versionPrefix}
      ORDER BY "embedding" <=> ${toVectorLiteral(embedding)}::vector
      LIMIT ${limit}
    `;
    return rows.map((r) => r.id);
  } catch (err) {
    logger.error({
      event: 'ai_semantic_search_failed',
      ...safeAiErrorFields(err, 'semantic_retrieval'),
    });
    return [];
  }
}

// 최후 폴백: 검색이 후보를 하나도 못 내면(시맨틱 벡터 없음/임베딩 장애 + 렉시컬 무일치)
// 라우터에 빈 목록을 주는 대신 전체 매뉴얼 카탈로그(제목·카테고리만, 요약 생략)를 넘긴다.
// 코퍼스가 ~100건이라 제목만이면 ~3k 토큰 — 정확도는 검색 경로보다 낮지만
// "후보 0개 → 안내 불가 폴백 문구"보다는 훨씬 낫다. 발동 시 로그를 남겨 운영에서 알아챈다.
async function catalogFallback(): Promise<Candidate[]> {
  const rows = await prisma.manualArticle.findMany({
    select: { id: true, question: true, category: { select: { slug: true, name: true } } },
    orderBy: [{ categoryId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    summary: null,
    categorySlug: r.category.slug,
    categoryName: r.category.name,
    score: 0,
  }));
}

async function withCatalogFallback(candidates: Candidate[], reason: string): Promise<Candidate[]> {
  if (candidates.length > 0) return candidates;
  const catalog = await catalogFallback();
  logger.info({ event: 'ai_retrieval_catalog_fallback', reason, catalogSize: catalog.length });
  return catalog;
}

// Retrieve the top-K most relevant manuals for a free-text situation, across
// ALL categories (no category filter — complex situations legitimately span
// several). This replaces stuffing the entire manual list into the prompt.
//
// Lexical ranking (trigram + scoreAndRank) is always computed. When hybrid
// search is enabled, pgvector semantic neighbours are fused in via weighted
// RRF; the interface (Candidate[]) is unchanged so callers never see the difference.
export async function retrieveCandidates(
  query: string,
  opts: { limit?: number } = {},
): Promise<Candidate[]> {
  const { limit = DEFAULT_TOP_K } = opts;

  const { ranked } = await rankManuals(query, { take: CANDIDATE_POOL });
  const toCandidate = (a: (typeof ranked)[number]): Candidate => ({
    id: a.id,
    question: a.question,
    summary: a.summary,
    categorySlug: a.category.slug,
    categoryName: a.category.name,
    score: a.score,
  });

  if (!hybridEnabled()) {
    return withCatalogFallback(ranked.slice(0, limit).map(toCandidate), 'lexical_only_no_match');
  }

  const byId = new Map<number, Candidate>(ranked.map((a) => [a.id, toCandidate(a)]));
  const lexicalIds = ranked.map((a) => a.id);
  const semanticIds = await semanticSearch(query, SEMANTIC_LIMIT);

  // 시맨틱에서만 나온 id는 메타데이터가 없으므로 보충 조회.
  const missing = semanticIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const rows = await prisma.manualArticle.findMany({
      where: { id: { in: missing } },
      include: { category: { select: { slug: true, name: true } } },
    });
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        question: r.question,
        summary: r.summary,
        categorySlug: r.category.slug,
        categoryName: r.category.name,
        score: 0,
      });
    }
  }

  // semanticIds가 비면(백필 전/실패) 사실상 렉시컬 단독 순위로 수렴한다.
  const fused = fuseRRF([lexicalIds, semanticIds], 60, [LEXICAL_WEIGHT, SEMANTIC_WEIGHT])
    .map((f) => byId.get(f.id))
    .filter((c): c is Candidate => c !== undefined)
    .slice(0, limit);
  return withCatalogFallback(fused, semanticIds.length === 0 ? 'semantic_unavailable_no_lexical_match' : 'no_match');
}
