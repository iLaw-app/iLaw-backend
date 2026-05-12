const SYNONYMS: Record<string, string[]> = {
  '알바비': ['월급', '임금', '급여', '아르바이트'],
  '월급': ['알바비', '임금', '급여'],
  '미지급': ['못 받음', '임금체불', '안 줌', '체불'],
  '싸불': ['사이버불링', '온라인 괴롭힘', '사이버 폭력'],
  '사이버불링': ['싸불', '온라인 괴롭힘', '사이버 폭력'],
};

export function expandQuery(query: string): string {
  const additions: string[] = [];
  for (const [term, synonyms] of Object.entries(SYNONYMS)) {
    if (query.includes(term)) {
      additions.push(...synonyms);
    }
  }
  return additions.length > 0 ? `${query} ${additions.join(' ')}` : query;
}
