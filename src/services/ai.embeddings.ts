import crypto from 'crypto';
import * as cheerio from 'cheerio';
import type OpenAI from 'openai';

// OpenAI 임베딩 유틸. text-embedding-3-small(1536d)로 매뉴얼/질의를 벡터화한다.
// pgvector 하이브리드 검색(ai.retrieval)과 백필 스크립트가 공유한다.

export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIM = 1536;

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

// 재임베딩 필요 여부 판정용 안정 해시(입력 텍스트가 바뀌면 해시도 바뀐다).
export function embedInputHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function embedText(input: string): Promise<number[]> {
  const res = await (await openai()).embeddings.create({ model: EMBED_MODEL, input });
  return res.data[0].embedding;
}

// pgvector 리터럴('[0.1,0.2,...]') — $queryRaw에서 ::vector 로 캐스팅해 사용.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
