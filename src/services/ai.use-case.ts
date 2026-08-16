import { logger } from '../middlewares/logging';
import type { AiDeferredTask } from './ai.background';
import { safeAiErrorFields } from './ai.logging';
import * as repository from './ai.repository';
import {
  consumeAiBurstSlot,
  diagnose,
  isMultiTurnEnabled,
  pruneAiChatHistory,
  refundAiBurstSlot,
  refundDailyAiRequest,
  reserveDailyAiRequest,
  type DiagnoseResult,
} from './ai.service';

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_CONVERSATION_ID_LENGTH = 128;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_STORED_HISTORY = 5;

interface ChatBody {
  message?: unknown;
  conversationId?: unknown;
}

export interface AiRequestContext {
  requestId: string;
  userId: string;
}

export class AiInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AiInputError';
  }
}

type ChatExecution =
  | {
    ok: true;
    body: DiagnoseResult & { conversationId?: string };
    backgroundTasks: AiDeferredTask[];
  }
  | { ok: false; status: 404 | 429; error: string; retryAfterSeconds?: number };

function parseMessage(body: unknown): { message: string; conversationId?: string } {
  const input: ChatBody = typeof body === 'object' && body !== null ? body : {};
  if (typeof input.message !== 'string' || !input.message.trim()) {
    throw new AiInputError('message is required');
  }
  const message = input.message.trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new AiInputError(`message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
  }

  if (input.conversationId !== undefined) {
    if (
      typeof input.conversationId !== 'string'
      || !input.conversationId.trim()
      || input.conversationId.length > MAX_CONVERSATION_ID_LENGTH
    ) {
      throw new AiInputError('conversationId must be a non-empty string of 128 characters or fewer');
    }
    return { message, conversationId: input.conversationId };
  }
  return { message };
}

function singleQueryValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new AiInputError(`${name} must be a single string`);
  return value;
}

function parseLimit(value: unknown): number {
  const raw = singleQueryValue(value, 'limit');
  if (raw === undefined) return DEFAULT_PAGE_LIMIT;
  if (!/^\d+$/.test(raw)) throw new AiInputError('limit must be an integer between 1 and 100');
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new AiInputError('limit must be an integer between 1 and 100');
  }
  return limit;
}

function parseConversationCursor(value: unknown): string | undefined {
  const cursor = singleQueryValue(value, 'cursor');
  if (cursor === undefined) return undefined;
  if (!cursor || cursor.length > MAX_CONVERSATION_ID_LENGTH) {
    throw new AiInputError('cursor must be a non-empty string of 128 characters or fewer');
  }
  return cursor;
}

function parseHistoryCursor(value: unknown): number | undefined {
  const cursor = singleQueryValue(value, 'cursor');
  if (cursor === undefined) return undefined;
  if (!/^\d+$/.test(cursor) || Number(cursor) < 1 || !Number.isSafeInteger(Number(cursor))) {
    throw new AiInputError('cursor must be a positive integer');
  }
  return Number(cursor);
}

function parseConversationId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_CONVERSATION_ID_LENGTH) {
    throw new AiInputError('conversationId must be a non-empty string of 128 characters or fewer');
  }
  return value;
}

function shouldSave(result: DiagnoseResult): boolean {
  return result.status === 'relevant'
    || result.status === 'crisis'
    || result.status === 'needs_clarification';
}

async function refundDailyWithoutMasking(context: AiRequestContext, conversationId?: string): Promise<void> {
  try {
    await refundDailyAiRequest(context.userId);
  } catch (error) {
    logger.error({
      event: 'ai_quota_refund_failed',
      requestId: context.requestId,
      userId: context.userId,
      conversationId,
      ...safeAiErrorFields(error, 'quota_refund'),
    });
  }
}

export async function executeChat(body: unknown, context: AiRequestContext): Promise<ChatExecution> {
  const input = parseMessage(body);
  const burstReservation = consumeAiBurstSlot(context.userId);
  if (!burstReservation.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'AI request rate limit exceeded',
      retryAfterSeconds: burstReservation.retryAfterSeconds,
    };
  }

  let dailyReserved = false;
  try {
    const dailyReservation = await reserveDailyAiRequest(context.userId);
    if (!dailyReservation.allowed) {
      refundAiBurstSlot(context.userId);
      return {
        ok: false,
        status: 429,
        error: 'AI daily request limit exceeded',
        retryAfterSeconds: dailyReservation.retryAfterSeconds,
      };
    }
    dailyReserved = true;

    let conversation: repository.AiConversationSummary | null = null;
    if (isMultiTurnEnabled()) {
      conversation = input.conversationId
        ? await repository.findConversation(context.userId, input.conversationId)
        : await repository.createConversation(context.userId);
      if (!conversation) {
        refundAiBurstSlot(context.userId);
        await refundDailyWithoutMasking(context, input.conversationId);
        dailyReserved = false;
        return { ok: false, status: 404, error: 'conversation not found' };
      }
    }

    const [user, history] = await repository.loadChatContext(context.userId, conversation?.id);
    const result = await diagnose(input.message, user?.nickname ?? undefined, history.reverse(), {
      region: user?.region ?? undefined,
      priorStatus: conversation?.lastStatus ?? undefined,
      userId: context.userId,
      conversationId: conversation?.id,
    });

    const backgroundContext = {
      requestId: context.requestId,
      userId: context.userId,
      conversationId: conversation?.id,
      diagnosisStatus: result.status,
    };
    const backgroundTasks: AiDeferredTask[] = [];
    if (shouldSave(result)) {
      backgroundTasks.push({
        start: () => repository.saveChatTurn(context.userId, conversation?.id, input.message, result)
          .then(() => pruneAiChatHistory(context.userId, MAX_STORED_HISTORY)),
        context: { event: 'ai_history_persistence_failed', ...backgroundContext },
      });
    }
    if (conversation) {
      backgroundTasks.push({
        start: () => repository.updateConversation(conversation, result),
        context: { event: 'ai_conversation_persistence_failed', ...backgroundContext },
      });
    }

    return {
      ok: true,
      body: conversation ? { ...result, conversationId: conversation.id } : result,
      backgroundTasks,
    };
  } catch (error) {
    if (dailyReserved) await refundDailyWithoutMasking(context, input.conversationId);
    throw error;
  }
}

interface RawPageQuery {
  limit?: unknown;
  cursor?: unknown;
}

function asPageQuery(query: unknown): RawPageQuery {
  return typeof query === 'object' && query !== null ? query : {};
}

export function getHistory(userId: string, query: unknown) {
  const raw = asPageQuery(query);
  return repository.listHistory(userId, {
    limit: parseLimit(raw.limit),
    cursor: parseHistoryCursor(raw.cursor),
  });
}

export function listConversations(userId: string, query: unknown) {
  const raw = asPageQuery(query);
  return repository.listConversationSummaries(userId, {
    limit: parseLimit(raw.limit),
    cursor: parseConversationCursor(raw.cursor),
  });
}

export function getConversation(userId: string, conversationId: unknown, query: unknown) {
  const raw = asPageQuery(query);
  return repository.getConversationDetail(userId, parseConversationId(conversationId), {
    limit: parseLimit(raw.limit),
    cursor: parseHistoryCursor(raw.cursor),
  });
}
