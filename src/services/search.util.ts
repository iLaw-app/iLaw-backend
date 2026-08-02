// Shared keyword-search ranking used by manual / qa / community search.
//
// For each candidate the score sums, over every weighted field:
//   lengthNorm(len) * weight * ( Σ_terms min(count(term), CAP) + (phrase match ? PHRASE_BOOST : 0) )
//
//   - term frequency (capped): repeated hits count, but with diminishing return,
//   - length normalization: a hit in a short title outranks an incidental hit in
//     long body text (log-scaled so it never fully drowns long fields),
//   - phrase boost: the original (pre-synonym) query appearing verbatim is a
//     strong exact-match signal.
//
// Results are sorted desc and kept above a RELATIVE cutoff (a fraction of the top
// score) rather than a fixed tier, so relevant-but-lower matches are not dropped
// wholesale. Finally capped at `limit`.

const OCCURRENCE_CAP = 3; // max counted occurrences per term per field
const PHRASE_BOOST = 1.5; // extra field weight when the verbatim phrase appears
const RELATIVE_CUTOFF = 0.1; // keep scores >= 10% of the top score
const DEFAULT_LIMIT = 10;

// Log-scaled length penalty in (0, 1]; short fields ~1, long fields gently damped.
function lengthNorm(len: number): number {
  return 1 / (1 + Math.log1p(len));
}

// Non-overlapping occurrences of `term` in `text` (both must be non-empty).
function countOccurrences(text: string, term: string): number {
  if (!text || !term) return 0;
  return text.split(term).length - 1;
}

export interface ScoreOptions {
  /** Original, pre-expansion query; when a field contains it verbatim, boosts that field. */
  phrase?: string;
  limit?: number;
}

export function scoreAndRank<T>(
  items: T[],
  terms: string[],
  weightedFields: (item: T) => Array<[string, number]>,
  options: ScoreOptions = {},
): Array<T & { score: number }> {
  const { phrase, limit = DEFAULT_LIMIT } = options;
  const phraseNeedle = phrase && phrase.length > 0 ? phrase : undefined;

  const scored = items.map((item) => {
    const fields = weightedFields(item);
    const score = fields.reduce((total, [text, weight]) => {
      if (!text) return total;
      const freq = terms.reduce((sum, term) => sum + Math.min(countOccurrences(text, term), OCCURRENCE_CAP), 0);
      const phraseHit = phraseNeedle && text.includes(phraseNeedle) ? PHRASE_BOOST : 0;
      return total + lengthNorm(text.length) * weight * (freq + phraseHit);
    }, 0);
    return Object.assign({ score }, item) as T & { score: number };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  const top = sorted.length > 0 ? sorted[0].score : 0;
  if (top <= 0) return [];
  const threshold = top * RELATIVE_CUTOFF;

  return sorted.filter((x) => x.score >= threshold).slice(0, limit);
}
