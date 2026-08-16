export const COMMUNITY_LIMITS = {
  title: 200,
  content: 10_000,
  comment: 2_000,
  pollOptions: 20,
  pollOptionLabel: 100,
  imageUrls: 10,
  imageUrl: 2_048,
  searchQuery: 200,
} as const;

export type CommunityPoll = { options: { label: string }[] };
export type CommunityPostInput = {
  title: string;
  content?: string;
  poll?: CommunityPoll;
  imageUrls?: string[];
};
export type CommunityPostUpdateInput = Partial<CommunityPostInput>;

type ValidationResult<T> = { data: T } | { error: string };

function validateOptionalContent(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined || value === null) return { data: undefined };
  if (typeof value !== 'string' || value.length > COMMUNITY_LIMITS.content) {
    return { error: 'invalid_content' };
  }
  return { data: value };
}

export function validatePollInput(value: unknown): ValidationResult<CommunityPoll> {
  if (!value || typeof value !== 'object' || !('options' in value)) return { error: 'invalid_poll' };
  const options = (value as { options?: unknown }).options;
  if (!Array.isArray(options) || options.length < 2 || options.length > COMMUNITY_LIMITS.pollOptions) {
    return { error: 'invalid_poll' };
  }

  const normalized: { label: string }[] = [];
  for (const option of options) {
    if (!option || typeof option !== 'object' || typeof (option as { label?: unknown }).label !== 'string') {
      return { error: 'invalid_poll' };
    }
    const label = (option as { label: string }).label.trim();
    if (!label || label.length > COMMUNITY_LIMITS.pollOptionLabel) return { error: 'invalid_poll' };
    normalized.push({ label });
  }
  return { data: { options: normalized } };
}

function validateImageUrls(value: unknown): ValidationResult<string[] | undefined> {
  if (value === undefined) return { data: undefined };
  if (!Array.isArray(value) || value.length > COMMUNITY_LIMITS.imageUrls) {
    return { error: 'invalid_image_urls' };
  }
  if (value.some((url) => typeof url !== 'string' || url.length === 0 || url.length > COMMUNITY_LIMITS.imageUrl)) {
    return { error: 'invalid_image_urls' };
  }
  return { data: value };
}

export function validateCreatePostInput(value: unknown): ValidationResult<CommunityPostInput> {
  if (!value || typeof value !== 'object') return { error: 'invalid_title' };
  const input = value as Record<string, unknown>;
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > COMMUNITY_LIMITS.title) {
    return { error: 'invalid_title' };
  }
  const content = validateOptionalContent(input.content);
  if ('error' in content) return content;
  const imageUrls = validateImageUrls(input.imageUrls);
  if ('error' in imageUrls) return imageUrls;

  let poll: CommunityPoll | undefined;
  if (input.poll !== undefined) {
    const parsed = validatePollInput(input.poll);
    if ('error' in parsed) return parsed;
    poll = parsed.data;
  }

  return {
    data: {
      title: input.title,
      ...(content.data !== undefined && { content: content.data }),
      ...(imageUrls.data !== undefined && { imageUrls: imageUrls.data }),
      ...(poll !== undefined && { poll }),
    },
  };
}

export function validateUpdatePostInput(value: unknown): ValidationResult<CommunityPostUpdateInput> {
  if (!value || typeof value !== 'object') return { error: 'invalid_request' };
  const input = value as Record<string, unknown>;
  if (input.title !== undefined
    && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > COMMUNITY_LIMITS.title)) {
    return { error: 'invalid_title' };
  }
  const content = validateOptionalContent(input.content);
  if ('error' in content) return content;
  const imageUrls = validateImageUrls(input.imageUrls);
  if ('error' in imageUrls) return imageUrls;

  let poll: CommunityPoll | undefined;
  if (input.poll !== undefined) {
    const parsed = validatePollInput(input.poll);
    if ('error' in parsed) return parsed;
    poll = parsed.data;
  }

  return {
    data: {
      ...(input.title !== undefined && { title: input.title as string }),
      ...(input.content !== undefined && { content: content.data }),
      ...(imageUrls.data !== undefined && { imageUrls: imageUrls.data }),
      ...(poll !== undefined && { poll }),
    },
  };
}

export function validateCommentInput(value: unknown): ValidationResult<{ content: string; parentId?: number }> {
  if (!value || typeof value !== 'object') return { error: 'invalid_comment' };
  const { content, parentId } = value as { content?: unknown; parentId?: unknown };
  if (typeof content !== 'string' || !content.trim() || content.length > COMMUNITY_LIMITS.comment) {
    return { error: 'invalid_comment' };
  }
  if (parentId !== undefined && (!Number.isInteger(parentId) || (parentId as number) <= 0)) {
    return { error: 'invalid_parent_id' };
  }
  return { data: { content, ...(parentId !== undefined && { parentId: parentId as number }) } };
}

export function validateVoteInput(value: unknown): ValidationResult<{ optionIndex: number }> {
  const optionIndex = value && typeof value === 'object'
    ? (value as { optionIndex?: unknown }).optionIndex
    : undefined;
  return typeof optionIndex === 'number' && Number.isInteger(optionIndex)
    ? { data: { optionIndex } }
    : { error: 'invalid_option' };
}

export function validateSearchQuery(value: unknown): ValidationResult<{ query: string }> {
  if (typeof value !== 'string' || value.length > COMMUNITY_LIMITS.searchQuery) {
    return { error: 'invalid_query' };
  }
  return { data: { query: value.trim() } };
}
