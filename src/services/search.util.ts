// Shared keyword-search ranking used by manual / qa / community search.
// For each item, score = sum over terms of the weight of every field that
// contains the term. Results are sorted desc, kept above a tiered threshold
// (>=10 -> 10, >=6 -> 6, else fallbackThreshold), and capped at `limit`.
export function scoreAndRank<T>(
  items: T[],
  terms: string[],
  weightedFields: (item: T) => Array<[string, number]>,
  fallbackThreshold: number,
  limit = 10,
): Array<T & { score: number }> {
  const scored = items.map((item) => {
    const fields = weightedFields(item);
    const score = terms.reduce(
      (acc, term) => acc + fields.reduce((sum, [text, weight]) => sum + (text.includes(term) ? weight : 0), 0),
      0,
    );
    return Object.assign({ score }, item) as T & { score: number };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  const threshold = sorted.some((x) => x.score >= 10) ? 10
    : sorted.some((x) => x.score >= 6) ? 6
    : fallbackThreshold;

  return sorted.filter((x) => x.score >= threshold).slice(0, limit);
}
