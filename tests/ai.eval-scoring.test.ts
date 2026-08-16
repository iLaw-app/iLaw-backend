import { describe, expect, it } from 'vitest';
import {
  checkGates,
  compareOverall,
  DEFAULT_THRESHOLDS,
  diffCases,
  scoreCase,
  summarizeScores,
  type CaseOutcome,
  type ResolvedCase,
} from '../prisma/eval/diagnose-scoring';

function resolved(overrides: Partial<ResolvedCase> = {}): ResolvedCase {
  return {
    id: 'c1',
    message: '사장님이 월급을 안 줘요',
    tags: ['labor', 'victim'],
    expect: { status: 'relevant', crisis: false, userRole: '피해자', manuals: ['임금'] },
    primaryIds: [1],
    acceptableIds: [2],
    forbiddenIds: [9],
    ...overrides,
  };
}

function outcome(overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    status: 'relevant',
    crisis: false,
    userRole: '피해자',
    retrievedIds: [1, 2, 3],
    retrievedWideIds: [1, 2, 3, 4],
    selectedIds: [1],
    ...overrides,
  };
}

describe('scoreCase — 층별 실패 귀속', () => {
  it('정답 선택·상태·위기·입장이 모두 맞으면 hard/soft 통과', () => {
    const s = scoreCase(resolved(), outcome());
    expect(s.failures).toEqual([]);
    expect(s.hardPass).toBe(true);
    expect(s.softPass).toBe(true);
    expect(s.retrievalRank).toBe(1);
    expect(s.selectionPrecision).toBe(1);
  });

  it('crisis 상태는 relevant 로 간주한다(위기 플래그가 붙은 relevant)', () => {
    const s = scoreCase(resolved({ expect: { status: 'relevant', manuals: ['x'] } }), outcome({ status: 'crisis', crisis: true }));
    expect(s.statusOk).toBe(true);
    expect(s.hardPass).toBe(true);
  });

  it('relevant 를 unrelated 로 판정하면 router-status 실패이고 선택 단계는 평가하지 않는다', () => {
    const s = scoreCase(resolved(), outcome({ status: 'unrelated', selectedIds: [], retrievedIds: [5, 6] }));
    expect(s.failures).toEqual(['router-status']);
    expect(s.hardPass).toBe(false);
  });

  it('정답이 후보에 없으면 retrieval, 후보엔 있는데 안 고르면 router-selection', () => {
    const missed = scoreCase(resolved(), outcome({ retrievedIds: [7, 8], selectedIds: [7] }));
    expect(missed.failures).toEqual(['retrieval']);
    expect(missed.retrievalWideHit).toBe(true); // top-20 에는 있었음
    expect(missed.wrongSelected).toEqual([7]);

    const notPicked = scoreCase(resolved(), outcome({ selectedIds: [3] }));
    expect(notPicked.failures).toEqual(['router-selection']);
    expect(notPicked.selectionHit).toBe(false);
  });

  it('acceptable 만 골라도 selection 은 실패지만 wrongSelected 에는 안 잡힌다', () => {
    const s = scoreCase(resolved(), outcome({ selectedIds: [2] }));
    expect(s.selectionHit).toBe(false);
    expect(s.wrongSelected).toEqual([]);
    expect(s.selectionPrecision).toBe(1);
  });

  it('금지 매뉴얼을 고르면 정답을 함께 골랐어도 router-selection 실패', () => {
    const s = scoreCase(resolved(), outcome({ selectedIds: [1, 9] }));
    expect(s.forbiddenSelected).toEqual([9]);
    expect(s.failures).toEqual(['router-selection']);
    expect(s.hardPass).toBe(false);
  });

  it('crisis/role 불일치는 soft 실패(hard 는 통과)', () => {
    const s = scoreCase(resolved(), outcome({ status: 'crisis', crisis: true, userRole: '가해자' }));
    expect(s.failures).toEqual(['crisis', 'router-role']);
    expect(s.hardPass).toBe(true);
    expect(s.softPass).toBe(false);
  });

  it('expect.crisis / userRole 이 없으면 채점하지 않는다', () => {
    const s = scoreCase(resolved({ expect: { status: 'relevant', manuals: ['x'] } }), outcome({ crisis: true, userRole: '가해자' }));
    expect(s.crisisOk).toBeUndefined();
    expect(s.roleOk).toBeUndefined();
    expect(s.softPass).toBe(true);
  });

  it('unrelated 케이스는 status 만 본다', () => {
    const c = resolved({ expect: { status: 'unrelated' }, primaryIds: [], acceptableIds: [], forbiddenIds: [] });
    expect(scoreCase(c, outcome({ status: 'unrelated', selectedIds: [], retrievedIds: [] })).hardPass).toBe(true);
    const wrong = scoreCase(c, outcome());
    expect(wrong.failures).toEqual(['router-status']);
    expect(wrong.retrievalHit).toBeUndefined();
  });

  it('실행 오류는 error 층으로 귀속된다', () => {
    const s = scoreCase(resolved(), outcome({ error: '429' }));
    expect(s.failures).toEqual(['error']);
    expect(s.hardPass).toBe(false);
  });
});

describe('summarizeScores / checkGates / compare', () => {
  const pass = scoreCase(resolved(), outcome());
  const retrievalMiss = scoreCase(resolved({ id: 'c2' }), outcome({ retrievedIds: [7], selectedIds: [] }));
  const unrelatedOk = scoreCase(
    resolved({ id: 'c3', expect: { status: 'unrelated' }, primaryIds: [], acceptableIds: [], forbiddenIds: [] }),
    outcome({ status: 'unrelated', selectedIds: [], retrievedIds: [] }),
  );

  it('지표는 해당 케이스가 있는 것만 분모로 삼는다', () => {
    const m = summarizeScores([pass, retrievalMiss, unrelatedOk]);
    expect(m.cases).toBe(3);
    expect(m.statusAccuracy).toBe(1);
    expect(m.retrievalRecall).toBe(0.5); // relevant 2건 중 1건
    expect(m.selectionHitRate).toBe(0.5);
    expect(m.hardPass).toBeCloseTo(2 / 3);
    expect(m.failuresByLayer.retrieval).toBe(1);
    expect(m.crisisAccuracy).toBe(1); // c1 만 채점 대상
    expect(summarizeScores([]).hardPass).toBeNull();
  });

  it('checkGates 는 임계치 미달 항목만 나열한다', () => {
    const m = summarizeScores([pass, retrievalMiss, unrelatedOk]);
    const violations = checkGates(m, DEFAULT_THRESHOLDS);
    expect(violations.some((v) => v.startsWith('retrievalRecall'))).toBe(true);
    expect(violations.some((v) => v.startsWith('statusAccuracy'))).toBe(false);
    expect(checkGates(summarizeScores([pass]), DEFAULT_THRESHOLDS)).toEqual([]);
  });

  it('compareOverall / diffCases 는 회귀·개선을 드러낸다', () => {
    const before = summarizeScores([pass, retrievalMiss]);
    const after = summarizeScores([pass, scoreCase(resolved({ id: 'c2' }), outcome())]);
    const delta = compareOverall(after, before).find((d) => d.metric === 'hardPass');
    expect(delta?.delta).toBeCloseTo(0.5);
    const diff = diffCases([pass, scoreCase(resolved({ id: 'c2' }), outcome())], [pass, retrievalMiss]);
    expect(diff.improved).toEqual(['c2']);
    expect(diff.regressed).toEqual([]);
  });
});
