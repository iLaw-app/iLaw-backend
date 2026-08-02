import { describe, it, expect } from 'vitest';
import { scoreAndRank } from '../src/services/search.util';

// Each item carries a `weight`; a field matches the single term 'x' only when
// `hit` is true, so the resulting score is deterministic (weight or 0).
type Item = { id: string; weight: number; hit: boolean };
const fields = (it: Item): Array<[string, number]> => [[it.hit ? 'x' : '', it.weight]];
const rank = (items: Item[], fallback: number, limit?: number) =>
  scoreAndRank(items, ['x'], fields, fallback, limit).map((r) => ({ id: r.id, score: r.score }));

describe('scoreAndRank', () => {
  it('scores by weighted fields and sorts descending', () => {
    const out = rank(
      [
        { id: 'a', weight: 2, hit: true },
        { id: 'b', weight: 5, hit: true },
        { id: 'c', weight: 3, hit: true },
      ],
      1,
    );
    expect(out).toEqual([
      { id: 'b', score: 5 },
      { id: 'c', score: 3 },
      { id: 'a', score: 2 },
    ]);
  });

  it('drops items below the fallback threshold', () => {
    const out = rank(
      [
        { id: 'hit', weight: 2, hit: true },
        { id: 'miss', weight: 9, hit: false }, // score 0
      ],
      1,
    );
    expect(out.map((r) => r.id)).toEqual(['hit']);
  });

  it('uses the 10 tier when any item scores >= 10', () => {
    const out = rank(
      [
        { id: 'top', weight: 10, hit: true },
        { id: 'mid', weight: 7, hit: true },
        { id: 'low', weight: 2, hit: true },
      ],
      1,
    );
    expect(out.map((r) => r.id)).toEqual(['top']);
  });

  it('uses the 6 tier when the max score is in [6, 10)', () => {
    const out = rank(
      [
        { id: 'seven', weight: 7, hit: true },
        { id: 'five', weight: 5, hit: true },
      ],
      1,
    );
    expect(out.map((r) => r.id)).toEqual(['seven']);
  });

  it('caps the result at the limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, weight: 2, hit: true }));
    expect(rank(items, 1, 2)).toHaveLength(2);
  });
});
