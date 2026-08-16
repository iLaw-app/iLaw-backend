// 상황 진단 AI 평가의 "순수" 채점 로직. DB·OpenAI 없이 동작하므로 유닛 테스트로 고정한다.
// 실행 러너(prisma/eval-diagnose.ts)는 관측값(CaseOutcome)을 모아 여기로 넘긴다.
//
// 층별 실패 귀속(failure layer):
//   router-status     : relevant/unrelated 분류가 틀림
//   retrieval         : 정답 매뉴얼이 라우터에게 보여준 후보(top-K)에 없음
//   router-selection  : 후보엔 있었는데 라우터가 안 고름 / 금지 매뉴얼을 고름
//   crisis            : 위기 판정 불일치 (expect.crisis 가 있을 때만)
//   router-role       : 사용자 입장 판정 불일치 (expect.userRole 이 있을 때만)
// status/retrieval/selection 은 hard fail, crisis/role 은 soft fail 로 집계한다.

export type ExpectedStatus = 'relevant' | 'unrelated';

export interface EvalCase {
  id: string;
  message: string;
  tags: string[];
  expect: {
    status: ExpectedStatus;
    crisis?: boolean;
    userRole?: string;
    manuals?: string[];
    acceptable?: string[];
    forbidden?: string[];
  };
}

// 매뉴얼 제목 → id 해석이 끝난 케이스.
export interface ResolvedCase extends EvalCase {
  primaryIds: number[];
  acceptableIds: number[];
  forbiddenIds: number[];
}

export interface CaseOutcome {
  status: string;
  crisis: boolean;
  userRole?: string;
  retrievedIds: number[]; // 라우터가 실제로 본 후보(순서 유지)
  retrievedWideIds?: number[]; // 더 넓게 뽑은 후보(예: top-20). recall@wide 계산용
  selectedIds: number[];
  latencyMs?: number;
  step1Tokens?: number;
  step2Tokens?: number;
  situationSummary?: string;
  legalAdvice?: string;
  error?: string;
}

export type FailureLayer = 'router-status' | 'retrieval' | 'router-selection' | 'crisis' | 'router-role' | 'error';

export interface CaseScore {
  id: string;
  tags: string[];
  statusOk: boolean;
  crisisOk?: boolean;
  roleOk?: boolean;
  // 아래 셋은 expect.manuals 가 있는 relevant 케이스에서만 채워진다.
  retrievalHit?: boolean;
  retrievalWideHit?: boolean;
  retrievalRank?: number; // 1-based, 정답 중 가장 먼저 나온 것의 순위(못 찾으면 undefined)
  selectionHit?: boolean;
  selectionPrecision?: number; // 선택 중 (primary ∪ acceptable) 비율. 선택 0개면 undefined
  forbiddenSelected: number[];
  wrongSelected: number[]; // primary ∪ acceptable 밖의 선택
  failures: FailureLayer[];
  hardPass: boolean;
  softPass: boolean;
}

const HARD_LAYERS: FailureLayer[] = ['router-status', 'retrieval', 'router-selection', 'error'];

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function firstRank(ids: number[], targets: Set<number>): number | undefined {
  const index = ids.findIndex((id) => targets.has(id));
  return index === -1 ? undefined : index + 1;
}

export function scoreCase(c: ResolvedCase, o: CaseOutcome): CaseScore {
  const failures: FailureLayer[] = [];
  const score: CaseScore = {
    id: c.id,
    tags: c.tags,
    statusOk: false,
    forbiddenSelected: [],
    wrongSelected: [],
    failures,
    hardPass: false,
    softPass: false,
  };

  if (o.error) {
    failures.push('error');
    return { ...score, hardPass: false, softPass: false };
  }

  // status: crisis 는 relevant 의 하위 상태(위기 플래그가 붙은 relevant)로 본다.
  const actualRelevant = o.status === 'relevant' || o.status === 'crisis' || o.status === 'needs_clarification';
  score.statusOk = c.expect.status === 'relevant' ? actualRelevant : o.status === 'unrelated';
  if (!score.statusOk) failures.push('router-status');

  if (c.expect.crisis !== undefined) {
    score.crisisOk = o.crisis === c.expect.crisis;
    if (!score.crisisOk) failures.push('crisis');
  }
  if (c.expect.userRole !== undefined && actualRelevant) {
    score.roleOk = o.userRole === c.expect.userRole;
    if (!score.roleOk) failures.push('router-role');
  }

  const primary = new Set(c.primaryIds);
  const allowed = new Set([...c.primaryIds, ...c.acceptableIds]);
  const forbidden = new Set(c.forbiddenIds);

  score.forbiddenSelected = o.selectedIds.filter((id) => forbidden.has(id));
  score.wrongSelected = o.selectedIds.filter((id) => !allowed.has(id));

  if (c.expect.status === 'relevant' && c.primaryIds.length > 0) {
    score.retrievalRank = firstRank(o.retrievedIds, primary);
    score.retrievalHit = score.retrievalRank !== undefined;
    if (o.retrievedWideIds) score.retrievalWideHit = firstRank(o.retrievedWideIds, primary) !== undefined;
    score.selectionHit = o.selectedIds.some((id) => primary.has(id));
    if (o.selectedIds.length > 0) {
      score.selectionPrecision = o.selectedIds.filter((id) => allowed.has(id)).length / o.selectedIds.length;
    }

    // status 가 이미 틀렸으면(unrelated 로 빠짐) 선택 단계는 평가 대상이 아니다.
    if (score.statusOk) {
      if (!score.retrievalHit) failures.push('retrieval');
      else if (!score.selectionHit) failures.push('router-selection');
    }
  }
  if (score.forbiddenSelected.length > 0 && !failures.includes('router-selection')) {
    failures.push('router-selection');
  }

  score.hardPass = !failures.some((f) => HARD_LAYERS.includes(f));
  score.softPass = failures.length === 0;
  return score;
}

export interface MetricBlock {
  cases: number;
  hardPass: number | null;
  softPass: number | null;
  statusAccuracy: number | null;
  crisisAccuracy: number | null;
  roleAccuracy: number | null;
  retrievalRecall: number | null;
  retrievalWideRecall: number | null;
  selectionHitRate: number | null;
  selectionPrecision: number | null;
  forbiddenSelections: number;
  failuresByLayer: Record<FailureLayer, number>;
}

export interface Summary {
  overall: MetricBlock;
  byTag: Record<string, MetricBlock>;
  latency: { p50Ms: number | null; p95Ms: number | null; meanMs: number | null };
  tokens: { step1Mean: number | null; step2Mean: number | null; total: number };
}

function emptyLayers(): Record<FailureLayer, number> {
  return { 'router-status': 0, retrieval: 0, 'router-selection': 0, crisis: 0, 'router-role': 0, error: 0 };
}

export function summarizeScores(scores: CaseScore[]): MetricBlock {
  const defined = <K extends keyof CaseScore>(key: K) => scores.filter((s) => s[key] !== undefined);
  const count = <K extends keyof CaseScore>(key: K) => defined(key).filter((s) => s[key] === true).length;
  const failuresByLayer = emptyLayers();
  for (const s of scores) for (const f of s.failures) failuresByLayer[f] += 1;
  const precisions = scores.map((s) => s.selectionPrecision).filter((p): p is number => p !== undefined);
  return {
    cases: scores.length,
    hardPass: rate(scores.filter((s) => s.hardPass).length, scores.length),
    softPass: rate(scores.filter((s) => s.softPass).length, scores.length),
    statusAccuracy: rate(scores.filter((s) => s.statusOk).length, scores.length),
    crisisAccuracy: rate(count('crisisOk'), defined('crisisOk').length),
    roleAccuracy: rate(count('roleOk'), defined('roleOk').length),
    retrievalRecall: rate(count('retrievalHit'), defined('retrievalHit').length),
    retrievalWideRecall: rate(count('retrievalWideHit'), defined('retrievalWideHit').length),
    selectionHitRate: rate(count('selectionHit'), defined('selectionHit').length),
    selectionPrecision: precisions.length ? precisions.reduce((a, b) => a + b, 0) / precisions.length : null,
    forbiddenSelections: scores.reduce((n, s) => n + s.forbiddenSelected.length, 0),
    failuresByLayer,
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function summarize(scores: CaseScore[], outcomes: Map<string, CaseOutcome>): Summary {
  const byTag: Record<string, MetricBlock> = {};
  const tags = [...new Set(scores.flatMap((s) => s.tags))].sort();
  for (const tag of tags) byTag[tag] = summarizeScores(scores.filter((s) => s.tags.includes(tag)));

  const latencies = [...outcomes.values()].map((o) => o.latencyMs).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  const step1 = [...outcomes.values()].map((o) => o.step1Tokens).filter((v): v is number => v !== undefined);
  const step2 = [...outcomes.values()].map((o) => o.step2Tokens).filter((v): v is number => v !== undefined);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    overall: summarizeScores(scores),
    byTag,
    latency: { p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95), meanMs: mean(latencies) },
    tokens: { step1Mean: mean(step1), step2Mean: mean(step2), total: [...step1, ...step2].reduce((a, b) => a + b, 0) },
  };
}

export interface Thresholds {
  minRetrievalRecall: number;
  minSelectionHitRate: number;
  minStatusAccuracy: number;
  maxForbiddenSelections: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minRetrievalRecall: 0.85,
  minSelectionHitRate: 0.75,
  minStatusAccuracy: 0.9,
  maxForbiddenSelections: 0,
};

// 임계치 위반 목록(비면 통과). null 지표(해당 케이스 없음)는 검사하지 않는다.
export function checkGates(overall: MetricBlock, t: Thresholds): string[] {
  const violations: string[] = [];
  const below = (name: string, value: number | null, min: number) => {
    if (value !== null && value < min) violations.push(`${name} ${value.toFixed(3)} < ${min}`);
  };
  below('retrievalRecall', overall.retrievalRecall, t.minRetrievalRecall);
  below('selectionHitRate', overall.selectionHitRate, t.minSelectionHitRate);
  below('statusAccuracy', overall.statusAccuracy, t.minStatusAccuracy);
  if (overall.forbiddenSelections > t.maxForbiddenSelections) {
    violations.push(`forbiddenSelections ${overall.forbiddenSelections} > ${t.maxForbiddenSelections}`);
  }
  return violations;
}

const COMPARED_METRICS: Array<keyof MetricBlock> = [
  'hardPass', 'softPass', 'statusAccuracy', 'crisisAccuracy', 'roleAccuracy',
  'retrievalRecall', 'retrievalWideRecall', 'selectionHitRate', 'selectionPrecision',
];

export interface MetricDelta { metric: string; baseline: number | null; current: number | null; delta: number | null }

export function compareOverall(current: MetricBlock, baseline: MetricBlock): MetricDelta[] {
  return COMPARED_METRICS.map((metric) => {
    const b = baseline[metric] as number | null;
    const c = current[metric] as number | null;
    return { metric, baseline: b, current: c, delta: b !== null && c !== null ? c - b : null };
  });
}

// 케이스별 통과 여부 변화(회귀/개선 목록).
export function diffCases(current: CaseScore[], baseline: CaseScore[]): { regressed: string[]; improved: string[] } {
  const base = new Map(baseline.map((s) => [s.id, s.hardPass]));
  const regressed: string[] = [];
  const improved: string[] = [];
  for (const s of current) {
    const before = base.get(s.id);
    if (before === undefined) continue;
    if (before && !s.hardPass) regressed.push(s.id);
    if (!before && s.hardPass) improved.push(s.id);
  }
  return { regressed, improved };
}
