import { describe, it, expect } from 'vitest';
import { scoreAndRank } from '../src/services/search.util';

// Helper: a single field carrying (text, weight). Score is deterministic given
// the formula, so we assert on ordering / membership rather than exact floats.
type Item = { id: string; text: string; weight: number };
const oneField = (it: Item): Array<[string, number]> => [[it.text, it.weight]];
const rank = (items: Item[], terms: string[], phrase?: string, limit?: number) =>
  scoreAndRank(items, terms, oneField, { phrase, limit }).map((r) => r.id);

describe('scoreAndRank', () => {
  it('ranks a short-title hit above an incidental hit in long body text', () => {
    const items: Item[] = [
      { id: 'title', text: '임금체불', weight: 2 }, // short, high weight
      { id: 'body', text: '가나다라'.repeat(200) + '임금체불' + '마바사'.repeat(200), weight: 1.5 },
    ];
    expect(rank(items, ['임금체불'])[0]).toBe('title');
  });

  it('rewards term frequency but with diminishing return (capped)', () => {
    const once: Item = { id: 'once', text: '해고 관련 글', weight: 2 };
    const many: Item = { id: 'many', text: '해고 해고 해고 해고 해고', weight: 2 };
    const out = rank([once, many], ['해고']);
    expect(out[0]).toBe('many'); // more occurrences -> higher
    expect(out).toContain('once');
  });

  it('caps occurrence contribution so spam cannot dominate arbitrarily', () => {
    // 10 occurrences counts the same as 3 (the cap) for a same-length field.
    const three: Item = { id: 'three', text: 'x x x', weight: 1 };
    const ten: Item = { id: 'ten', text: 'x x x x x x x x x x', weight: 1 };
    const scored = scoreAndRank([three, ten], ['x'], oneField, {});
    // ten is longer so its lengthNorm is smaller; capping means it should NOT
    // outrank three despite having many more raw hits.
    const threeScore = scored.find((s) => s.id === 'three')!.score;
    const tenScore = scored.find((s) => s.id === 'ten')!.score;
    expect(threeScore).toBeGreaterThan(tenScore);
  });

  it('boosts a verbatim phrase match', () => {
    const phraseHit: Item = { id: 'phrase', text: '알바비 못 받음', weight: 2 };
    const splitHit: Item = { id: 'split', text: '알바비 관련 못 받은 사례 정리', weight: 2 };
    // Both contain the expanded terms, but only `phrase` contains the verbatim query.
    const out = rank([splitHit, phraseHit], ['알바비', '못', '받음'], '알바비 못 받음');
    expect(out[0]).toBe('phrase');
  });

  it('keeps lower-scored but relevant results (relative cutoff, no hard tier)', () => {
    const items: Item[] = [
      { id: 'strong', text: '임금 임금 임금', weight: 2 },
      { id: 'weak', text: '임금 이야기', weight: 2 },
    ];
    // Old tiered logic could drop `weak` entirely; the relative cutoff keeps it.
    expect(rank(items, ['임금'])).toEqual(expect.arrayContaining(['strong', 'weak']));
  });

  it('drops noise far below the top score', () => {
    const items: Item[] = [
      { id: 'top', text: '임금'.repeat(3), weight: 2 },
      { id: 'noise', text: '임금' + '무관한내용'.repeat(500), weight: 0.1 },
    ];
    const out = rank(items, ['임금']);
    expect(out[0]).toBe('top');
    expect(out).not.toContain('noise');
  });

  it('ignores empty field text and empty terms without crashing', () => {
    const items: Item[] = [{ id: 'a', text: '', weight: 2 }];
    expect(rank(items, [''])).toEqual([]);
  });

  it('caps the result at the limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, text: 'x', weight: 2 }));
    expect(rank(items, ['x'], undefined, 2)).toHaveLength(2);
  });
});
