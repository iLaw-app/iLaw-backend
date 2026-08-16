import prisma from '../prisma/client';
import type { DiagnoseResult } from './ai.service';

export interface AiConversationSummary {
  id: string;
  lastStatus: string | null;
  title: string | null;
}

export interface AiListPage {
  limit: number;
  cursor?: string;
}

export interface AiHistoryPage {
  limit: number;
  cursor?: number;
}

export interface AiPageResult<T> {
  data: T;
  limit: number;
  nextCursor?: string;
}

export class InvalidAiCursorError extends Error {
  readonly status = 400;

  constructor() {
    super('invalid cursor');
    this.name = 'InvalidAiCursorError';
  }
}

function boundedPage<T extends { id: string | number }>(rows: T[], limit: number): AiPageResult<T[]> {
  const hasNext = rows.length > limit;
  const data = hasNext ? rows.slice(0, limit) : rows;
  return {
    data,
    limit,
    ...(hasNext ? { nextCursor: String(data[data.length - 1].id) } : {}),
  };
}

export function findConversation(userId: string, conversationId: string) {
  return prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, lastStatus: true, title: true },
  });
}

export function createConversation(userId: string) {
  return prisma.aiConversation.create({
    data: { userId },
    select: { id: true, lastStatus: true, title: true },
  });
}

export function loadChatContext(userId: string, conversationId?: string) {
  return Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, region: true },
    }),
    prisma.aiChatHistory.findMany({
      where: conversationId ? { conversationId, userId } : { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { question: true, legalAdvice: true },
    }),
  ]);
}

export function saveChatTurn(
  userId: string,
  conversationId: string | undefined,
  question: string,
  result: DiagnoseResult,
) {
  return prisma.aiChatHistory.create({
    data: {
      userId,
      conversationId: conversationId ?? null,
      question,
      situationSummary: result.situationSummary,
      legalAdvice: result.legalAdvice || result.followUpQuestion || '',
      suggestions: result.suggestions,
      status: result.status,
    },
  });
}

export function updateConversation(conversation: AiConversationSummary, result: DiagnoseResult) {
  return prisma.aiConversation.update({
    where: { id: conversation.id },
    data: {
      lastStatus: result.status,
      ...(conversation.title || !result.situationSummary
        ? {}
        : { title: result.situationSummary.slice(0, 80) }),
    },
  });
}

export async function listHistory(userId: string, page: AiHistoryPage) {
  const boundary = page.cursor === undefined
    ? undefined
    : await prisma.aiChatHistory.findFirst({
      where: { id: page.cursor, userId },
      select: { id: true, createdAt: true },
    });
  if (page.cursor !== undefined && !boundary) throw new InvalidAiCursorError();

  const rows = await prisma.aiChatHistory.findMany({
    where: {
      userId,
      ...(boundary ? {
        OR: [
          { createdAt: { gt: boundary.createdAt } },
          { createdAt: boundary.createdAt, id: { gt: boundary.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: page.limit + 1,
    select: {
      id: true,
      question: true,
      situationSummary: true,
      legalAdvice: true,
      suggestions: true,
      createdAt: true,
    },
  });
  return boundedPage(rows, page.limit);
}

export async function listConversationSummaries(userId: string, page: AiListPage) {
  const boundary = page.cursor === undefined
    ? undefined
    : await prisma.aiConversation.findFirst({
      where: { id: page.cursor, userId },
      select: { id: true, updatedAt: true },
    });
  if (page.cursor !== undefined && !boundary) throw new InvalidAiCursorError();

  // Live-order policy: updatedAt is resolved when each next-page request arrives.
  // A conversation mutated between requests therefore moves according to its current ordering value.
  const rows = await prisma.aiConversation.findMany({
    where: {
      userId,
      ...(boundary ? {
        OR: [
          { updatedAt: { lt: boundary.updatedAt } },
          { updatedAt: boundary.updatedAt, id: { lt: boundary.id } },
        ],
      } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
    select: {
      id: true,
      title: true,
      status: true,
      lastStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return boundedPage(rows, page.limit);
}

export async function getConversationDetail(userId: string, conversationId: string, page: AiHistoryPage) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      id: true,
      title: true,
      status: true,
      lastStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!conversation) return null;

  const boundary = page.cursor === undefined
    ? undefined
    : await prisma.aiChatHistory.findFirst({
      where: { id: page.cursor, userId, conversationId },
      select: { id: true, createdAt: true },
    });
  if (page.cursor !== undefined && !boundary) throw new InvalidAiCursorError();

  const rows = await prisma.aiChatHistory.findMany({
    where: {
      userId,
      conversationId,
      ...(boundary ? {
        OR: [
          { createdAt: { gt: boundary.createdAt } },
          { createdAt: boundary.createdAt, id: { gt: boundary.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: page.limit + 1,
    select: {
      id: true,
      question: true,
      situationSummary: true,
      legalAdvice: true,
      suggestions: true,
      status: true,
      createdAt: true,
    },
  });
  const messages = boundedPage(rows, page.limit);
  return {
    data: { ...conversation, messages: messages.data },
    limit: messages.limit,
    ...(messages.nextCursor ? { nextCursor: messages.nextCursor } : {}),
  };
}
