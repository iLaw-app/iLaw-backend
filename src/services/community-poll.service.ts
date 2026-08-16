import prisma from '../prisma/client';
import { runCommunitySerializableTransaction } from './community-transaction';

export type PollOptionDefinition = { label: string };
export type PollDefinition = { options: PollOptionDefinition[] };
export type PollVoteCount = { optionIndex: number; _count: { _all: number } };

export function parsePollInput(
  poll: unknown,
): { data: PollDefinition } | { error: 'invalid_poll' } {
  if (!poll || typeof poll !== 'object' || !('options' in poll)) return { error: 'invalid_poll' };
  const options = (poll as { options?: unknown }).options;
  if (!Array.isArray(options)) return { error: 'invalid_poll' };

  const normalized: PollOptionDefinition[] = [];
  for (const option of options) {
    if (!option || typeof option !== 'object') return { error: 'invalid_poll' };
    const label = String((option as { label?: unknown }).label ?? '').trim();
    if (!label) return { error: 'invalid_poll' };
    normalized.push({ label });
  }

  return normalized.length >= 2
    ? { data: { options: normalized } }
    : { error: 'invalid_poll' };
}

export function normalizeStoredPoll(poll: unknown): PollDefinition | null {
  if (!poll || typeof poll !== 'object' || !('options' in poll)) return null;
  const options = (poll as { options?: unknown }).options;
  if (!Array.isArray(options)) return null;

  const normalized = options
    .map((option) => {
      if (!option || typeof option !== 'object') return null;
      const label = String((option as { label?: unknown }).label ?? '').trim();
      return label ? { label } : null;
    })
    .filter((option): option is PollOptionDefinition => !!option);

  return normalized.length >= 2 ? { options: normalized } : null;
}

export function formatPoll(
  poll: unknown,
  voteCounts: PollVoteCount[] = [],
  votedOptionIndex?: number | null,
) {
  const normalized = normalizeStoredPoll(poll);
  if (!normalized) return null;
  const counts = new Map(voteCounts.map((row) => [row.optionIndex, row._count._all]));
  const options = normalized.options.map((option, index) => ({
    ...option,
    votes: counts.get(index) ?? 0,
  }));
  return {
    options,
    total: options.reduce((sum, option) => sum + option.votes, 0),
    votedOptionIndex: votedOptionIndex ?? null,
  };
}

export async function getVoteCounts(postIds: number[]) {
  if (postIds.length === 0) return new Map<number, PollVoteCount[]>();
  const rows = await prisma.communityPollVote.groupBy({
    by: ['postId', 'optionIndex'],
    where: { postId: { in: postIds } },
    _count: { _all: true },
  });

  const byPost = new Map<number, PollVoteCount[]>();
  for (const row of rows) {
    const counts = byPost.get(row.postId) ?? [];
    counts.push({ optionIndex: row.optionIndex, _count: row._count });
    byPost.set(row.postId, counts);
  }
  return byPost;
}

export function samePollOptions(left: unknown, right: PollDefinition) {
  const normalized = normalizeStoredPoll(left);
  return !!normalized
    && normalized.options.length === right.options.length
    && normalized.options.every((option, index) => option.label === right.options[index].label);
}

export async function votePoll(postId: number, userId: string, optionIndex: number) {
  return runCommunitySerializableTransaction(
    (operation, options) => prisma.$transaction(operation, options),
    async (tx) => {
      const post = await tx.communityPost.findUnique({
        where: { id: postId },
        select: { id: true, poll: true },
      });
      if (!post) return { error: 'not_found' as const };

      const poll = normalizeStoredPoll(post.poll);
      if (!poll) return { error: 'no_poll' as const };
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
        return { error: 'invalid_option' as const };
      }

      await tx.communityPollVote.upsert({
        where: { userId_postId: { userId, postId } },
        create: { userId, postId, optionIndex },
        update: { optionIndex },
      });

      const voteCounts = await tx.communityPollVote.groupBy({
        by: ['optionIndex'],
        where: { postId },
        _count: { _all: true },
      });
      return { data: { poll: formatPoll(poll, voteCounts, optionIndex) } };
    },
  );
}