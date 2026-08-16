import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../../src/prisma/client';
import { buildEmbedInput } from '../../src/services/ai.embeddings';
import { rankManuals } from '../../src/services/manual.service';
import { fuseRRF } from '../../src/services/ai.retrieval';

// 검색(retrieval) 전략 실험실 — LLM 호출 없이 임베딩만으로 "정답 매뉴얼이 후보 top-K 에
// 드는가"를 비교한다. 임베딩 모델/차원, 문서 임베딩 입력(전문 vs 제목+요약), 렉시컬과의
// 융합 방식(RRF 가중치)을 바꿔 가며 recall@K / MRR 을 본다.
//
// 골든 케이스(diagnose-cases.json)의 relevant 케이스와 로컬 DB 매뉴얼을 사용하고,
// 임베딩은 eval-results/embed-cache.json 에 캐시한다(재실행 시 비용 0).
//
// 실행: npx ts-node prisma/eval/retrieval-lab.ts
//       npx ts-node prisma/eval/retrieval-lab.ts --models=text-embedding-3-large@1536,text-embedding-3-small@1536
//
// 참고 결과(2026-08, 113 케이스): small@1536 semFull r@8=0.894 → large@1536 semFull r@8=0.973.
// 이 실험을 근거로 EMBED_MODEL 을 large@1536 으로 바꿨다(ai.embeddings.ts).

const CACHE = path.join(__dirname, '..', '..', 'eval-results', 'embed-cache.json');
const DEFAULT_MODELS = ['text-embedding-3-large@1536', 'text-embedding-3-small@1536'];

type Cache = Record<string, number[]>;
const cache: Cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
function saveCache() {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

async function embedBatch(model: string, dims: number | undefined, texts: string[]): Promise<number[][]> {
  const key = (t: string) => `${model}|${dims ?? 'full'}|${t}`;
  const missing = texts.filter((t) => !cache[key(t)]);
  if (missing.length > 0) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: process.env[['OPENAI', 'API', 'KEY'].join('_')] });
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const res = await client.embeddings.create({ model, input: chunk, ...(dims ? { dimensions: dims } : {}) });
      res.data.forEach((d, j) => { cache[key(chunk[j])] = d.embedding; });
      saveCache();
    }
  }
  return texts.map((t) => cache[key(t)]);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

function parseModels(args: string[]): Array<{ name: string; model: string; dims?: number }> {
  const raw = args.find((a) => a.startsWith('--models='))?.slice('--models='.length);
  return (raw ? raw.split(',') : DEFAULT_MODELS).map((spec) => {
    const [model, dims] = spec.split('@');
    return { name: spec, model, dims: dims ? Number(dims) : undefined };
  });
}

async function main() {
  const models = parseModels(process.argv.slice(2));
  const casesRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'diagnose-cases.json'), 'utf8')).cases as Array<{
    id: string; message: string; expect: { status: string; manuals?: string[] };
  }>;
  const manuals = await prisma.manualArticle.findMany({ select: { id: true, question: true, summary: true, content: true } });
  const byQuestion = new Map(manuals.map((m) => [m.question, m.id]));
  const cases = casesRaw
    .filter((c) => c.expect.status === 'relevant')
    .map((c) => ({ id: c.id, msg: c.message, primary: (c.expect.manuals ?? []).map((q) => byQuestion.get(q)).filter((id): id is number => id !== undefined) }));

  const fullInputs = manuals.map((m) => buildEmbedInput(m.question, m.summary, m.content));
  const titleSummaryInputs = manuals.map((m) => [m.question, m.summary ?? ''].filter(Boolean).join('\n'));

  const lexical = new Map<string, number[]>();
  for (const c of cases) lexical.set(c.id, (await rankManuals(c.msg, { take: 150 })).ranked.map((a) => a.id));

  const n = cases.length;
  console.log(`n=${n} relevant cases, ${manuals.length} manuals`);
  for (const cfg of models) {
    const docFull = await embedBatch(cfg.model, cfg.dims, fullInputs);
    const docTS = await embedBatch(cfg.model, cfg.dims, titleSummaryInputs);
    const queries = await embedBatch(cfg.model, cfg.dims, cases.map((c) => c.msg));

    const rankBy = (i: number, docs: number[][]) =>
      manuals.map((m, j) => [m.id, cosine(queries[i], docs[j])] as const).sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 20);
    const strategies: Record<string, (i: number) => number[]> = {
      'semFull': (i) => rankBy(i, docFull),
      'semTitleSummary': (i) => rankBy(i, docTS),
      'RRF(lex,semFull)': (i) => fuseRRF([lexical.get(cases[i].id)!, rankBy(i, docFull)]).map((f) => f.id),
      'RRF(lex0.5,semFull) [prod]': (i) => fuseRRF([lexical.get(cases[i].id)!, rankBy(i, docFull)], 60, [0.5, 1]).map((f) => f.id),
      'RRF(semFull,semTS)': (i) => fuseRRF([rankBy(i, docFull), rankBy(i, docTS)]).map((f) => f.id),
    };

    console.log(`\n== ${cfg.name} ==`);
    for (const [name, fn] of Object.entries(strategies)) {
      let r5 = 0, r8 = 0, r12 = 0, mrr = 0;
      const misses: string[] = [];
      cases.forEach((c, i) => {
        const rank = fn(i).findIndex((id) => c.primary.includes(id)) + 1;
        if (rank && rank <= 5) r5++;
        if (rank && rank <= 8) r8++;
        if (rank && rank <= 12) r12++;
        if (rank) mrr += 1 / rank;
        if (!rank || rank > 12) misses.push(`${c.id}:${rank || '-'}`);
      });
      console.log(`${name.padEnd(28)} r@5=${(r5 / n).toFixed(3)} r@8=${(r8 / n).toFixed(3)} r@12=${(r12 / n).toFixed(3)} mrr=${(mrr / n).toFixed(3)}  miss>12: ${misses.join(' ') || '-'}`);
    }
  }
  saveCache();
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
