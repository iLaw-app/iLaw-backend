import { describe, expect, it } from 'vitest';
import { planEmbeddingBackfill, hasEmbeddingApiKey } from '../prisma/embed-manuals';
import { buildEmbedInput, embedInputHash, EMBED_VERSION, isCurrentEmbedVersion } from '../src/services/ai.embeddings';

const row = (id: number, content: string, storedHash: string | null) => ({
  id, question: `Q${id}`, summary: null, content, embedInputHash: storedHash,
});

describe('planEmbeddingBackfill', () => {
  it('해시가 현재 입력·버전과 같은 행은 건너뛰고, 신규/변경/구버전 행만 계획에 넣는다', () => {
    const upToDate = embedInputHash(buildEmbedInput('Q1', null, '<p>같은 본문</p>'));
    const rows = [
      row(1, '<p>같은 본문</p>', upToDate),          // 최신
      row(2, '<p>새 매뉴얼</p>', null),               // 신규(임베딩 없음)
      row(3, '<p>바뀐 본문</p>', 'old-model@1536:abc'), // 모델 교체 전 해시
      row(4, '<p>수정됨</p>', embedInputHash(buildEmbedInput('Q4', null, '<p>수정 전</p>'))), // 본문 변경
    ];
    const plan = planEmbeddingBackfill(rows);
    expect(plan.map((p) => p.id)).toEqual([2, 3, 4]);
    expect(plan[0].input).toBe('Q2\n새 매뉴얼'); // HTML 제거된 평문
    expect(plan.every((p) => p.hash.startsWith(`${EMBED_VERSION}:`))).toBe(true);
  });

  it('임베딩 버전 접두사로 검색 가능 여부를 판정한다', () => {
    expect(isCurrentEmbedVersion(embedInputHash('x'))).toBe(true);
    expect(isCurrentEmbedVersion('text-embedding-3-small@1536:deadbeef')).toBe(false);
    expect(isCurrentEmbedVersion('deadbeef')).toBe(false); // 버전 도입 전 형식
    expect(isCurrentEmbedVersion(null)).toBe(false);
  });

  it('hasEmbeddingApiKey 는 키 유무만 본다', () => {
    expect(hasEmbeddingApiKey({} as NodeJS.ProcessEnv)).toBe(false);
    expect(hasEmbeddingApiKey({ [['OPENAI', 'API', 'KEY'].join('_')]: 'sk-test' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
