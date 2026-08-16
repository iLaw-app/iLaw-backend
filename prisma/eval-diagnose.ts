import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../src/prisma/client';
import { logger } from '../src/middlewares/logging';
import { DEFAULT_TOP_K, retrieveCandidates } from '../src/services/ai.retrieval';
import { diagnose } from '../src/services/ai.service';
import {
  checkGates,
  compareOverall,
  DEFAULT_THRESHOLDS,
  diffCases,
  scoreCase,
  summarize,
  type CaseOutcome,
  type CaseScore,
  type EvalCase,
  type ResolvedCase,
  type Summary,
  type Thresholds,
} from './eval/diagnose-scoring';

// 상황 진단 AI 정확도 평가 러너 (골든 케이스 기반 e2e).
//
// 프로덕션 진단 로직(retrieveCandidates → 라우터 → 생성)을 실제 DB + 실제 OpenAI 로
// 호출하되, 인증·쿼터·이력 저장은 거치지 않는다. 케이스마다 층별(검색/라우터/위기)
// 실패를 귀속하고, 결과 JSON 을 eval-results/ 에 남겨 이전 실행과 비교한다.
//
// 사용:
//   npm run ai:eval                                    # 전체 실행, 결과 저장 + 베이스라인 비교
//   npm run ai:eval -- --only=labor,crisis             # 태그 필터(OR)
//   npm run ai:eval -- --id=sch-perp-01                # 단일 케이스
//   npm run ai:eval -- --hybrid=off                    # 렉시컬 단독 A/B
//   npm run ai:eval -- --save-baseline                 # 이번 결과를 베이스라인으로 저장
//   npm run ai:eval -- --gate                          # 임계치 미달 시 exit 1 (회귀 게이트)
//
// 비용: 케이스당 라우터(gpt-4o) 1회 + 생성(gpt-4o-mini) ≤1회 + 임베딩 2회. 130케이스 ≈ $1 미만.
// 주의: 프로덕션 DB 를 가리키면 안 된다(읽기만 하지만 OpenAI 비용·로그 오염). 로컬 DB 전용.

const CASE_FILE = path.join(__dirname, 'eval/diagnose-cases.json');
const OUT_DIR = path.join(__dirname, '..', 'eval-results');
const BASELINE_FILE = path.join(OUT_DIR, 'diagnose-baseline.json');
const ROUTER_TOP_K = DEFAULT_TOP_K; // 라우터가 실제로 보는 후보 개수
const WIDE_TOP_K = 20;
const ADVICE_SNIPPET = 400;

interface Options {
  only: string[];
  id?: string;
  limit?: number;
  concurrency: number;
  hybrid: boolean;
  crisis: boolean;
  multiturn: boolean;
  region: string;
  baseline?: string;
  saveBaseline: boolean;
  gate: boolean;
  thresholds: Thresholds;
  verbose: boolean;
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
function readNumber(args: string[], name: string, fallback: number): number {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}
function readSwitch(args: string[], name: string, fallback: boolean): boolean {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;
  if (raw !== 'on' && raw !== 'off') throw new Error(`--${name} must be on|off`);
  return raw === 'on';
}

function parseOptions(args: string[]): Options {
  return {
    only: (readOption(args, 'only') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    id: readOption(args, 'id'),
    limit: readOption(args, 'limit') ? readNumber(args, 'limit', 0) : undefined,
    concurrency: readNumber(args, 'concurrency', 2),
    hybrid: readSwitch(args, 'hybrid', true),
    crisis: readSwitch(args, 'crisis', true),
    multiturn: readSwitch(args, 'multiturn', false),
    region: readOption(args, 'region') ?? '서울',
    baseline: readOption(args, 'baseline'),
    saveBaseline: args.includes('--save-baseline'),
    gate: args.includes('--gate'),
    thresholds: {
      minRetrievalRecall: readNumber(args, 'min-recall', DEFAULT_THRESHOLDS.minRetrievalRecall),
      minSelectionHitRate: readNumber(args, 'min-selection', DEFAULT_THRESHOLDS.minSelectionHitRate),
      minStatusAccuracy: readNumber(args, 'min-status', DEFAULT_THRESHOLDS.minStatusAccuracy),
      maxForbiddenSelections: readNumber(args, 'max-forbidden', DEFAULT_THRESHOLDS.maxForbiddenSelections),
    },
    verbose: args.includes('--verbose'),
  };
}

// ── 케이스 로드/검증 ─────────────────────────────────────────────

function loadCases(): EvalCase[] {
  const parsed = JSON.parse(fs.readFileSync(CASE_FILE, 'utf8')) as { cases?: unknown };
  if (!Array.isArray(parsed.cases)) throw new Error(`${CASE_FILE}: "cases" must be an array`);
  const seen = new Set<string>();
  const cases: EvalCase[] = [];
  for (const raw of parsed.cases as Array<Record<string, unknown>>) {
    const id = raw.id;
    if (typeof id !== 'string' || !id) throw new Error('case without id');
    if (seen.has(id)) throw new Error(`duplicate case id: ${id}`);
    seen.add(id);
    if (typeof raw.message !== 'string' || !raw.message.trim()) throw new Error(`${id}: message required`);
    if (!Array.isArray(raw.tags) || raw.tags.length === 0) throw new Error(`${id}: tags required`);
    const expect = raw.expect as EvalCase['expect'] | undefined;
    if (!expect || (expect.status !== 'relevant' && expect.status !== 'unrelated')) {
      throw new Error(`${id}: expect.status must be relevant|unrelated`);
    }
    if (expect.status === 'relevant' && (!expect.manuals || expect.manuals.length === 0)) {
      throw new Error(`${id}: relevant case needs expect.manuals`);
    }
    cases.push({ id, message: raw.message, tags: raw.tags as string[], expect });
  }
  return cases;
}

type ManualIndex = Map<string, Array<{ id: number; slug: string }>>;

async function loadManualIndex(): Promise<ManualIndex> {
  const rows = await prisma.manualArticle.findMany({
    select: { id: true, question: true, category: { select: { slug: true } } },
  });
  const index: ManualIndex = new Map();
  for (const r of rows) {
    const list = index.get(r.question) ?? [];
    list.push({ id: r.id, slug: r.category.slug });
    index.set(r.question, list);
  }
  return index;
}

// "slug::제목" 또는 "제목". 제목이 여러 카테고리에 있으면 slug 지정을 강제한다.
function resolveTitle(ref: string, index: ManualIndex, problems: string[], caseId: string): number | undefined {
  const [maybeSlug, rest] = ref.includes('::') ? ref.split('::', 2) : [undefined, ref];
  const matches = index.get(rest) ?? [];
  const filtered = maybeSlug ? matches.filter((m) => m.slug === maybeSlug) : matches;
  if (filtered.length === 1) return filtered[0].id;
  problems.push(
    filtered.length === 0
      ? `${caseId}: 매뉴얼 없음 → "${ref}"`
      : `${caseId}: 제목이 여러 카테고리에 있음(slug:: 접두사 필요) → "${ref}"`,
  );
  return undefined;
}

function resolveCases(cases: EvalCase[], index: ManualIndex): ResolvedCase[] {
  const problems: string[] = [];
  const resolved = cases.map((c) => {
    const resolveAll = (refs?: string[]) =>
      (refs ?? []).map((r) => resolveTitle(r, index, problems, c.id)).filter((id): id is number => id !== undefined);
    return {
      ...c,
      primaryIds: resolveAll(c.expect.manuals),
      acceptableIds: resolveAll(c.expect.acceptable),
      forbiddenIds: resolveAll(c.expect.forbidden),
    };
  });
  if (problems.length > 0) {
    throw new Error(`골든 케이스가 DB 매뉴얼과 맞지 않습니다(${problems.length}건). 제목을 정확히 맞추세요:\n  ${problems.join('\n  ')}`);
  }
  return resolved;
}

// ── 관측 지표 캡처(구조화 로그 가로채기) ─────────────────────────

interface CapturedMetrics {
  userRole?: string;
  retrievedIds?: number[];
  selectedIds?: number[];
  step1Tokens?: number;
  step2Tokens?: number;
}

function installLogCapture(): { metrics: Map<string, CapturedMetrics>; semanticFailures: () => number; errors: Record<string, unknown>[] } {
  const metrics = new Map<string, CapturedMetrics>();
  const errors: Record<string, unknown>[] = [];
  let semanticFailures = 0;
  // 진단 로직은 요청당 한 줄 JSON 로그를 stdout 에 쓴다. 평가에서는 그 로그를 콘솔에
  // 흘리는 대신 케이스별 지표로 흡수한다(userId 에 케이스 id 를 실어 상관).
  logger.info = (fields) => {
    if (fields.event === 'ai_diagnosis' && typeof fields.userId === 'string' && fields.userId.startsWith('eval:')) {
      metrics.set(fields.userId.slice('eval:'.length), {
        userRole: typeof fields.userRole === 'string' ? fields.userRole : undefined,
        retrievedIds: Array.isArray(fields.retrievedIds) ? (fields.retrievedIds as number[]) : undefined,
        selectedIds: Array.isArray(fields.selectedIds) ? (fields.selectedIds as number[]) : undefined,
        step1Tokens: typeof fields.step1Tokens === 'number' ? fields.step1Tokens : undefined,
        step2Tokens: typeof fields.step2Tokens === 'number' ? fields.step2Tokens : undefined,
      });
    }
  };
  logger.error = (fields) => {
    if (fields.event === 'ai_semantic_search_failed') semanticFailures += 1;
    errors.push(fields);
  };
  return { metrics, semanticFailures: () => semanticFailures, errors };
}

// ── 실행 ─────────────────────────────────────────────────────────

// OpenAI 429(조직 TPM 한도)는 SDK 자체 재시도(2회, 짧은 백오프)로 부족할 때가 있어
// 러너 차원에서 안내된 대기 시간만큼 쉬었다가 다시 시도한다. 그 외 오류는 즉시 실패.
const RATE_LIMIT_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 크레딧 소진/쿼터 초과는 기다려도 풀리지 않는다 → 재시도 없이 전체 실행을 중단한다.
// (계속 돌리면 남은 케이스가 전부 error 로 기록돼 결과가 오염된다.)
function isBillingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no credits|insufficient_quota|billing|exceeded your current quota/i.test(message);
}
let abortReason: string | null = null;

function rateLimitWaitMs(err: unknown, attempt: number): number | null {
  const message = err instanceof Error ? err.message : String(err);
  if (isBillingError(err)) return null;
  if (!/429|rate limit/i.test(message)) return null;
  const hinted = /try again in ([\d.]+)s/i.exec(message);
  const base = hinted ? Number(hinted[1]) * 1000 : 5_000;
  return Math.ceil(base + 1_000 + attempt * 2_000);
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const wait = rateLimitWaitMs(err, attempt);
      if (wait === null || attempt >= RATE_LIMIT_RETRIES) throw err;
      await sleep(wait);
    }
  }
}

async function runCase(c: ResolvedCase, opts: Options, captured: Map<string, CapturedMetrics>): Promise<CaseOutcome> {
  if (abortReason) {
    return { status: 'error', crisis: false, retrievedIds: [], selectedIds: [], error: `aborted: ${abortReason}` };
  }
  try {
    const wide = await withRateLimitRetry(() => retrieveCandidates(c.message, { limit: WIDE_TOP_K }));
    const startedAt = Date.now();
    const result = await withRateLimitRetry(() =>
      diagnose(c.message, '테스트', [], { region: opts.region, userId: `eval:${c.id}` }));
    const latencyMs = Date.now() - startedAt;
    const m = captured.get(c.id);
    return {
      status: result.status,
      crisis: result.status === 'crisis',
      userRole: m?.userRole,
      // 라우터가 본 후보는 로그에서, 없으면(로그 유실) 넓은 검색의 앞부분으로 대체.
      retrievedIds: m?.retrievedIds ?? wide.slice(0, ROUTER_TOP_K).map((x) => x.id),
      retrievedWideIds: wide.map((x) => x.id),
      selectedIds: result.suggestions.filter((s): s is { type: 'manual'; id: number; label: string } => s.type === 'manual').map((s) => s.id),
      latencyMs,
      step1Tokens: m?.step1Tokens,
      step2Tokens: m?.step2Tokens,
      situationSummary: result.situationSummary,
      legalAdvice: result.legalAdvice.slice(0, ADVICE_SNIPPET),
    };
  } catch (err) {
    if (isBillingError(err) && !abortReason) {
      abortReason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n[eval] ❌ OpenAI 과금/쿼터 오류 — 남은 케이스를 중단합니다: ${abortReason}\n`);
    }
    return {
      status: 'error', crisis: false, retrievedIds: [], selectedIds: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

// ── 리포트 ───────────────────────────────────────────────────────

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '  n/a' : `${(v * 100).toFixed(1).padStart(5)}%`);

function printSummary(summary: Summary, semanticFailures: number, opts: Options): void {
  const o = summary.overall;
  console.log('\n══════════ 요약 ══════════');
  console.log(`cases=${o.cases}  hybrid=${opts.hybrid ? 'on' : 'off'}  crisis=${opts.crisis ? 'on' : 'off'}  router=${process.env.AI_ROUTER_MODEL || 'gpt-4o'}  gen=${process.env.AI_GENERATION_MODEL || 'gpt-4o-mini'}`);
  console.log(`hard pass        ${pct(o.hardPass)}   (status·검색·선택 모두 통과)`);
  console.log(`soft pass        ${pct(o.softPass)}   (+위기·입장까지 통과)`);
  console.log(`status acc       ${pct(o.statusAccuracy)}`);
  console.log(`retrieval@${ROUTER_TOP_K}      ${pct(o.retrievalRecall)}   retrieval@${WIDE_TOP_K} ${pct(o.retrievalWideRecall)}`);
  console.log(`selection hit    ${pct(o.selectionHitRate)}   precision ${pct(o.selectionPrecision)}   forbidden=${o.forbiddenSelections}`);
  console.log(`crisis acc       ${pct(o.crisisAccuracy)}   role acc ${pct(o.roleAccuracy)}`);
  console.log(`failures by layer: ${Object.entries(o.failuresByLayer).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join('  ') || '(none)'}`);
  console.log(`latency p50=${summary.latency.p50Ms ?? '-'}ms p95=${summary.latency.p95Ms ?? '-'}ms   tokens step1≈${Math.round(summary.tokens.step1Mean ?? 0)} step2≈${Math.round(summary.tokens.step2Mean ?? 0)} total=${summary.tokens.total}`);
  if (semanticFailures > 0) console.log(`⚠ semantic search failed ${semanticFailures}회 — 임베딩/pgvector 확인 (렉시컬로 폴백됨)`);
  if (abortReason) console.log(`❌ 실행이 중단되었습니다(과금/쿼터): ${abortReason}\n   error 로 기록된 케이스는 재실행이 필요합니다. 이 결과는 베이스라인으로 저장하지 마세요.`);

  console.log('\n── 태그별 (hard / retrieval@8 / selection / status) ──');
  for (const [tag, m] of Object.entries(summary.byTag)) {
    console.log(`${tag.padEnd(22)} n=${String(m.cases).padStart(3)}  ${pct(m.hardPass)}  ${pct(m.retrievalRecall)}  ${pct(m.selectionHitRate)}  ${pct(m.statusAccuracy)}`);
  }
}

function printFailures(cases: ResolvedCase[], scores: CaseScore[], outcomes: Map<string, CaseOutcome>, titles: Map<number, string>, verbose: boolean): void {
  const failed = scores.filter((s) => s.failures.length > 0);
  if (failed.length === 0) { console.log('\n모든 케이스 통과 ✅'); return; }
  console.log(`\n══════════ 실패 ${failed.length}건 ══════════`);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const t = (id: number) => `${titles.get(id) ?? '?'}(#${id})`;
  for (const s of failed) {
    const c = byId.get(s.id)!;
    const o = outcomes.get(s.id)!;
    console.log(`\n[${s.id}] ${s.failures.join(', ')}  tags=${c.tags.join(',')}`);
    console.log(`  msg      : ${c.message}`);
    console.log(`  expect   : status=${c.expect.status}${c.expect.crisis !== undefined ? ` crisis=${c.expect.crisis}` : ''}${c.expect.userRole ? ` role=${c.expect.userRole}` : ''}`);
    if (c.primaryIds.length) console.log(`  want     : ${c.primaryIds.map(t).join(' | ')}`);
    console.log(`  got      : status=${o.status} crisis=${o.crisis}${o.userRole ? ` role=${o.userRole}` : ''}${o.error ? ` error=${o.error}` : ''}`);
    if (o.selectedIds.length) console.log(`  selected : ${o.selectedIds.map((id) => `${c.primaryIds.includes(id) ? '✓' : c.acceptableIds.includes(id) ? '~' : c.forbiddenIds.includes(id) ? '✗✗' : '✗'}${t(id)}`).join(' | ')}`);
    if (s.retrievalHit === false || verbose) {
      const marks = o.retrievedIds.map((id, i) => `${i + 1}.${c.primaryIds.includes(id) ? '✓' : ''}${t(id)}`);
      console.log(`  retrieved: ${marks.join(' | ') || '(none)'}`);
      if (s.retrievalHit === false && s.retrievalWideHit) console.log(`  ↳ top-${WIDE_TOP_K}에는 있음 (top-k 확대/재랭킹으로 잡힐 가능성)`);
    }
    if (verbose && o.situationSummary) console.log(`  summary  : ${o.situationSummary}`);
  }
}

function printComparison(current: { summary: Summary; scores: CaseScore[] }, baselinePath: string): void {
  if (!fs.existsSync(baselinePath)) { console.log(`\n(베이스라인 없음: ${path.relative(process.cwd(), baselinePath)} — --save-baseline 로 저장)`); return; }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as { summary: Summary; scores: CaseScore[]; meta?: { timestamp?: string } };
  console.log(`\n══════════ 베이스라인 비교 (${baseline.meta?.timestamp ?? '?'}) ══════════`);
  for (const d of compareOverall(current.summary.overall, baseline.summary.overall)) {
    const arrow = d.delta === null ? '' : d.delta > 0.0005 ? ' ▲' : d.delta < -0.0005 ? ' ▼' : ' =';
    console.log(`${d.metric.padEnd(20)} ${pct(d.baseline)} → ${pct(d.current)}${d.delta === null ? '' : ` (${(d.delta * 100).toFixed(1)}p)`}${arrow}`);
  }
  const { regressed, improved } = diffCases(current.scores, baseline.scores);
  if (regressed.length) console.log(`회귀: ${regressed.join(', ')}`);
  if (improved.length) console.log(`개선: ${improved.join(', ')}`);
}

// ── main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));

  // 진단 로직이 읽는 플래그를 평가 옵션으로 고정한다(프로덕션 기본: hybrid on, crisis on, multiturn off).
  process.env.AI_HYBRID_SEARCH_ENABLED = opts.hybrid ? 'true' : 'false';
  process.env.AI_CRISIS_ENABLED = opts.crisis ? 'true' : 'false';
  process.env.AI_MULTITURN_ENABLED = opts.multiturn ? 'true' : 'false';
  if (!process.env[['OPENAI', 'API', 'KEY'].join('_')]) throw new Error('OPENAI API key env is required for eval');

  let cases = loadCases();
  const total = cases.length;
  if (opts.id) cases = cases.filter((c) => c.id === opts.id);
  if (opts.only.length) cases = cases.filter((c) => c.tags.some((t) => opts.only.includes(t)));
  if (opts.limit) cases = cases.slice(0, opts.limit);
  if (cases.length === 0) throw new Error('no cases matched the filter');

  const index = await loadManualIndex();
  const titles = new Map<number, string>();
  for (const [question, entries] of index) for (const e of entries) titles.set(e.id, question);
  const resolved = resolveCases(cases, index);
  console.log(`[eval] ${resolved.length}/${total} cases, ${index.size} manuals in DB, concurrency=${opts.concurrency}`);

  const capture = installLogCapture();
  const startedAt = Date.now();
  let done = 0;
  const outcomes = new Map<string, CaseOutcome>();
  await runPool(resolved, opts.concurrency, async (c) => {
    const outcome = await runCase(c, opts, capture.metrics);
    outcomes.set(c.id, outcome);
    done += 1;
    if (done % 10 === 0 || done === resolved.length) process.stderr.write(`[eval] ${done}/${resolved.length}\n`);
  });

  const scores = resolved.map((c) => scoreCase(c, outcomes.get(c.id)!));
  const summary = summarize(scores, outcomes);

  printSummary(summary, capture.semanticFailures(), opts);
  printFailures(resolved, scores, outcomes, titles, opts.verbose);
  if (opts.verbose && capture.errors.length) {
    console.log(`\n── 진단 중 오류 로그 ${capture.errors.length}건 ──`);
    for (const e of capture.errors.slice(0, 20)) console.log('  ', JSON.stringify(e));
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const report = {
    meta: {
      timestamp,
      durationMs: Date.now() - startedAt,
      caseFile: path.relative(process.cwd(), CASE_FILE),
      cases: resolved.length,
      filter: { only: opts.only, id: opts.id ?? null, limit: opts.limit ?? null },
      flags: { hybrid: opts.hybrid, crisis: opts.crisis, multiturn: opts.multiturn },
      models: { router: process.env.AI_ROUTER_MODEL || 'gpt-4o', generation: process.env.AI_GENERATION_MODEL || 'gpt-4o-mini' },
      semanticFailures: capture.semanticFailures(),
    },
    summary,
    scores,
    outcomes: Object.fromEntries(outcomes),
  };
  const outFile = path.join(OUT_DIR, `diagnose-${timestamp.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'diagnose-latest.json'), JSON.stringify(report, null, 2));
  console.log(`\n결과 저장: ${path.relative(process.cwd(), outFile)}`);

  const isFullRun = !opts.id && opts.only.length === 0 && !opts.limit;
  printComparison({ summary, scores }, opts.baseline ?? BASELINE_FILE);
  if (opts.saveBaseline) {
    if (summary.overall.failuresByLayer.error > 0) console.log('⚠ error 케이스가 있는 실행은 베이스라인으로 저장하지 않습니다.');
    else if (!isFullRun) console.log('⚠ 필터가 걸린 실행은 베이스라인으로 저장하지 않습니다.');
    else { fs.writeFileSync(BASELINE_FILE, JSON.stringify(report, null, 2)); console.log(`베이스라인 저장: ${path.relative(process.cwd(), BASELINE_FILE)}`); }
  }

  if (opts.gate) {
    const violations = checkGates(summary.overall, opts.thresholds);
    if (violations.length) {
      console.error(`\n❌ 품질 게이트 실패:\n  ${violations.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ 품질 게이트 통과');
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
