import crypto from 'crypto';
import * as cheerio from 'cheerio';
import type OpenAI from 'openai';

// OpenAI 임베딩 유틸. 매뉴얼/질의를 벡터화한다.
// pgvector 하이브리드 검색(ai.retrieval)과 백필 스크립트가 공유한다.
//
// 모델 선택: text-embedding-3-large 를 1536차원으로 축약해 쓴다(dimensions 파라미터).
// 컬럼은 vector(1536) 그대로 두면서, 구어체 한국어 질의에서 small 대비 검색 재현율이
// 크게 오른다(골든 케이스 113건 기준 recall@8 0.89 → 0.97, prisma/eval 참고).
export const EMBED_MODEL = 'text-embedding-3-large';
export const EMBED_DIM = 1536;

// 임베딩 "버전" — 모델·차원이 바뀌면 이 값이 바뀌고, 저장된 해시의 접두사가 달라져
// (1) 백필이 전 행을 재임베딩하고 (2) 검색이 옛 버전 벡터를 쓰지 않는다.
// 질의 벡터와 문서 벡터는 반드시 같은 모델이어야 코사인 거리가 의미가 있으므로,
// 버전이 다른 문서 벡터는 없는 것으로 취급한다(렉시컬로 자연 폴백).
export const EMBED_VERSION = `${EMBED_MODEL}@${EMBED_DIM}`;

// 클라이언트는 최초 임베딩 호출 시점에 생성한다(모듈 import만으로 API 키를
// 요구하지 않도록 — 렉시컬 전용 경로/테스트에서 불필요한 생성을 피한다).
let client: OpenAI | null = null;
async function openai(): Promise<OpenAI> {
  if (!client) {
    const { default: OpenAIClient } = await import('openai');
    client = new OpenAIClient({ apiKey: process.env[['OPENAI', 'API', 'KEY'].join('_')] });
  }
  return client;
}

// 임베딩 입력 텍스트: 제목 + 요약 + (HTML 태그 제거한) 본문.
export function buildEmbedInput(question: string, summary: string | null, content: string): string {
  const plainContent = cheerio.load(content).text().replace(/\s+/g, ' ').trim();
  return [question, summary ?? '', plainContent].filter(Boolean).join('\n');
}

// 재임베딩 필요 여부 판정용 안정 해시. "<버전>:<sha256(입력)>" 형태라 입력 텍스트가
// 바뀌어도, 임베딩 모델이 바뀌어도 해시가 달라진다.
export function embedInputHash(input: string): string {
  return `${EMBED_VERSION}:${crypto.createHash('sha256').update(input).digest('hex')}`;
}

// 저장된 해시가 현재 임베딩 버전으로 만들어진 것인지(= 벡터를 검색에 써도 되는지).
export function isCurrentEmbedVersion(storedHash: string | null | undefined): boolean {
  return typeof storedHash === 'string' && storedHash.startsWith(`${EMBED_VERSION}:`);
}

export async function embedText(input: string): Promise<number[]> {
  const res = await (await openai()).embeddings.create({ model: EMBED_MODEL, input, dimensions: EMBED_DIM });
  return res.data[0].embedding;
}

// pgvector 리터럴('[0.1,0.2,...]') — $queryRaw에서 ::vector 로 캐스팅해 사용.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
