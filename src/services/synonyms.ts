import prisma from '../prisma/client';

// Synonym groups now live in the SearchSynonym table (data-driven, editable
// without a deploy). The seed / source of truth is the migration
// 20260802060000_search_synonyms_and_trgm_indexes.

// Pure expansion: the query plus every term of each group the query touches
// (dedup, query always first). Exported for unit testing without a DB.
export function expandWithGroups(query: string, groups: string[][]): string[] {
  const terms = new Set<string>([query]);
  for (const group of groups) {
    if (group.some((term) => query.includes(term))) {
      group.forEach((term) => terms.add(term));
    }
  }
  return [...terms];
}

const TTL_MS = 5 * 60 * 1000;
let cache: { groups: string[][]; loadedAt: number } | null = null;

async function loadSynonymGroups(): Promise<string[][]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < TTL_MS) return cache.groups;

  const rows = await prisma.searchSynonym.findMany({
    select: { groupId: true, term: true },
    orderBy: { groupId: 'asc' },
  });
  const byGroup = new Map<number, string[]>();
  for (const { groupId, term } of rows) {
    const group = byGroup.get(groupId);
    if (group) group.push(term);
    else byGroup.set(groupId, [term]);
  }
  const groups = [...byGroup.values()];
  cache = { groups, loadedAt: now };
  return groups;
}

// Expand a search query using the synonym groups. Falls back to just the query
// itself when the table is empty (e.g. not yet seeded), so search never breaks.
export async function expandQuery(query: string): Promise<string[]> {
  const groups = await loadSynonymGroups();
  return expandWithGroups(query, groups);
}

// Drop the in-process cache (tests, or after editing synonyms in the DB).
export function clearSynonymCache(): void {
  cache = null;
}
