import type { PrismaClient } from '@prisma/client';
import {
  buildEmbedInput,
  embedInputHash,
  embedText,
  toVectorLiteral,
} from '../src/services/ai.embeddings';

// 매뉴얼 임베딩 backfill 의 공용 코어. backfill-embeddings.ts(단독 실행)와
// notion-migrate.ts(콘텐츠 적재 직후 자동 실행)가 함께 쓴다.
//
// 재실행 안전(idempotent): 입력 텍스트(제목+요약+본문)+임베딩 버전의 해시가 저장된
// embedInputHash 와 다른 행만 (재)임베딩한다. 콘텐츠가 바뀌거나 임베딩 모델이 바뀌면
// 해시가 달라져 자동으로 다시 계산 대상이 된다.

export interface EmbeddableRow {
  id: number;
  question: string;
  summary: string | null;
  content: string;
  embedInputHash: string | null;
}

export interface EmbedPlanItem {
  id: number;
  input: string;
  hash: string;
}

// 순수 함수: 어떤 행이 (재)임베딩이 필요한지 계산한다. 유닛 테스트 대상.
export function planEmbeddingBackfill(rows: EmbeddableRow[]): EmbedPlanItem[] {
  return rows
    .map((r) => {
      const input = buildEmbedInput(r.question, r.summary, r.content);
      return { id: r.id, input, hash: embedInputHash(input), current: r.embedInputHash };
    })
    .filter((r) => r.hash !== r.current)
    .map(({ id, input, hash }) => ({ id, input, hash }));
}

export function hasEmbeddingApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[['OPENAI', 'API', 'KEY'].join('_')]);
}

export interface BackfillOptions {
  apply: boolean;
  log?: (message: string) => void;
  batchSize?: number;
}

export interface BackfillResult {
  total: number;
  pending: number;
  embedded: number;
}

// 대상 행을 조회해 계획을 세우고(apply=false 면 여기까지), 순차 임베딩 후 벡터+해시를 저장한다.
export async function backfillManualEmbeddings(
  prisma: PrismaClient,
  { apply, log = console.log, batchSize = 50 }: BackfillOptions,
): Promise<BackfillResult> {
  const rows = await prisma.manualArticle.findMany({
    select: { id: true, question: true, summary: true, content: true, embedInputHash: true },
  });
  const pending = planEmbeddingBackfill(rows);
  log(`[embed] ${pending.length}/${rows.length} manuals need (re)embedding`);

  if (!apply || pending.length === 0) return { total: rows.length, pending: pending.length, embedded: 0 };

  let done = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    for (const item of pending.slice(i, i + batchSize)) {
      const vector = await embedText(item.input);
      await prisma.$executeRaw`
        UPDATE "ManualArticle"
        SET "embedding" = ${toVectorLiteral(vector)}::vector,
            "embedInputHash" = ${item.hash}
        WHERE "id" = ${item.id}
      `;
      done += 1;
    }
    log(`[embed] ${done}/${pending.length} done`);
  }
  return { total: rows.length, pending: pending.length, embedded: done };
}
