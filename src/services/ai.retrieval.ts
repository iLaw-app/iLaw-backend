import prisma from '../prisma/client';
import { rankManuals } from './manual.service';
import { embedText, toVectorLiteral } from './ai.embeddings';
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

const DEFAULT_TOP_K = 8;
const CANDIDATE_POOL = 150; // rows pulled from DB before ranking
const SEMANTIC_LIMIT = 20; // semantic neighbours fetched before fusion

function hybridEnabled(): boolean {
  return process.env.AI_HYBRID_SEARCH_ENABLED === 'true';
}

// Reciprocal Rank Fusion: merge several ranked id-lists into one, robust to the
// two rankers' incomparable score scales. Pure — exported for unit testing.
export function fuseRRF(rankedLists: number[][], k = 60): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const list of rankedLists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// Semantic neighbours via pgvector cosine distance. Returns ids in similarity
// order. Any failure (no embeddings backfilled yet, embedding API down, pgvector
// absent) degrades to [] so the caller falls back to lexical-only ranking.
async function semanticSearch(query: string, limit: number): Promise<number[]> {
  try {
    const embedding = await embedText(query);
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT "id"
      FROM "ManualArticle"
      WHERE "embedding" IS NOT NULL
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

// Retrieve the top-K most relevant manuals for a free-text situation, across
// ALL categories (no category filter — complex situations legitimately span
// several). This replaces stuffing the entire manual list into the prompt.
//
// Lexical ranking (trigram + scoreAndRank) is always computed. When hybrid
// search is enabled, pgvector semantic neighbours are fused in via RRF; the
// interface (Candidate[]) is unchanged so callers never see the difference.
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
    return ranked.slice(0, limit).map(toCandidate);
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
  return fuseRRF([lexicalIds, semanticIds])
    .map((f) => byId.get(f.id))
    .filter((c): c is Candidate => c !== undefined)
    .slice(0, limit);
}
