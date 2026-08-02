import { describe, it, expect } from 'vitest';
import { expandWithGroups } from '../src/services/synonyms';

const GROUPS = [
  ['알바', '아르바이트', '알바비', '시급'],
  ['해고', '권고사직', '퇴사'],
];

describe('expandWithGroups', () => {
  it('always includes the original query first', () => {
    expect(expandWithGroups('안녕', GROUPS)[0]).toBe('안녕');
  });

  it('returns only the query when no group is touched', () => {
    expect(expandWithGroups('전혀무관', GROUPS)).toEqual(['전혀무관']);
  });

  it('expands to every term of a group the query contains', () => {
    const out = expandWithGroups('알바비 못 받음', GROUPS);
    expect(out).toEqual(expect.arrayContaining(['알바비 못 받음', '알바', '아르바이트', '알바비', '시급']));
    expect(out).not.toContain('해고'); // other group untouched
  });

  it('merges multiple matched groups without duplicates', () => {
    const out = expandWithGroups('알바 하다 권고사직', GROUPS);
    expect(out).toEqual(expect.arrayContaining(['알바', '아르바이트', '해고', '권고사직', '퇴사']));
    expect(new Set(out).size).toBe(out.length);
  });
});
