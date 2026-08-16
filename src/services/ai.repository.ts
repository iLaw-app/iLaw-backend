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
      where: conversationId ? { conversationId } : { userId },
      orderBy: { createdAt: 'desc' },
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

export function listHistory(userId: string, page: AiHistoryPage) {
  return prisma.aiChatHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    take: page.limit,
    ...(page.cursor === undefined ? {} : { cursor: { id: page.cursor }, skip: 1 }),
    select: {
      id: true,
      question: true,
      situationSummary: true,
      legalAdvice: true,
      suggestions: true,
      createdAt: true,
    },
  });
}

export function listConversationSummaries(userId: string, page: AiListPage) {
  return prisma.aiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: page.limit,
    ...(page.cursor === undefined ? {} : { cursor: { id: page.cursor }, skip: 1 }),
    select: {
      id: true,
      title: true,
      status: true,
      lastStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export function getConversationDetail(userId: string, conversationId: string, page: AiHistoryPage) {
  return prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      id: true,
      title: true,
      status: true,
      lastStatus: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        take: page.limit,
        ...(page.cursor === undefined ? {} : { cursor: { id: page.cursor }, skip: 1 }),
        select: {
          id: true,
          question: true,
          situationSummary: true,
          legalAdvice: true,
          suggestions: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
}
