import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/authenticate';
import prisma from '../prisma/client';
import {
  consumeAiBurstSlot,
  diagnose,
  isMultiTurnEnabled,
  pruneAiChatHistory,
  refundAiBurstSlot,
  refundDailyAiRequest,
  reserveDailyAiRequest,
} from '../services/ai.service';

const MAX_MESSAGE_LENGTH = 2_000;
const CONVERSATION_HISTORY_TURNS = 5;
const MAX_STORED_HISTORY = 5;

export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { message } = req.body ?? {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
      return;
    }

    const userId = req.userId!;
    const burstReservation = consumeAiBurstSlot(userId);
    if (!burstReservation.allowed) {
      res.set('Retry-After', String(burstReservation.retryAfterSeconds));
      res.status(429).json({ error: 'AI request rate limit exceeded' });
      return;
    }

    let dailyReserved = false;
    try {
      const dailyReservation = await reserveDailyAiRequest(userId);
      if (!dailyReservation.allowed) {
        refundAiBurstSlot(userId);
        res.set('Retry-After', String(dailyReservation.retryAfterSeconds));
        res.status(429).json({ error: 'AI daily request limit exceeded' });
        return;
      }
      dailyReserved = true;

      // ── 대화 스레드 해석(멀티턴 활성 시에만) ──
      // 멀티턴이 꺼져 있으면 기존 동작(전역 최근 히스토리, 스레드 없음)을 그대로 유지한다.
      const multiTurn = isMultiTurnEnabled();
      const requestedConversationId =
        typeof req.body?.conversationId === 'string' ? req.body.conversationId : undefined;

      let conversation: { id: string; lastStatus: string | null; title: string | null } | null = null;
      if (multiTurn) {
        if (requestedConversationId) {
          conversation = await prisma.aiConversation.findFirst({
            where: { id: requestedConversationId, userId },
            select: { id: true, lastStatus: true, title: true },
          });
          if (!conversation) {
            refundAiBurstSlot(userId);
            await refundDailyAiRequest(userId);
            res.status(404).json({ error: 'conversation not found' });
            return;
          }
        } else {
          conversation = await prisma.aiConversation.create({
            data: { userId },
            select: { id: true, lastStatus: true, title: true },
          });
        }
      }

      const [user, history] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { nickname: true, region: true } }),
        prisma.aiChatHistory.findMany({
          // 스레드가 있으면 해당 대화의 최근 턴만, 없으면 기존처럼 사용자 전역 최근 턴.
          where: conversation ? { conversationId: conversation.id } : { userId },
          orderBy: { createdAt: 'desc' },
          take: CONVERSATION_HISTORY_TURNS,
          select: { question: true, legalAdvice: true },
        }),
      ]);
      const nickname = user?.nickname ?? undefined;
      const recentHistory = history.reverse();

      const result = await diagnose(trimmedMessage, nickname, recentHistory, {
        region: user?.region ?? undefined,
        priorStatus: conversation?.lastStatus ?? undefined,
        userId,
        conversationId: conversation?.id,
      });

      // 진단 턴 저장: 안내(relevant·crisis) 또는 되묻기(needs_clarification)처럼
      // 어시스턴트 발화가 있는 턴만 저장한다. unrelated는 문맥 가치가 없어 제외.
      if (
        result.status === 'relevant' ||
        result.status === 'crisis' ||
        result.status === 'needs_clarification'
      ) {
        const assistantText = result.legalAdvice || result.followUpQuestion || '';
        prisma.aiChatHistory.create({
          data: {
            userId,
            conversationId: conversation?.id ?? null,
            question: trimmedMessage,
            situationSummary: result.situationSummary,
            legalAdvice: assistantText,
            suggestions: result.suggestions,
            status: result.status,
          },
          // 저장 후 사용자당 최신 MAX_STORED_HISTORY개만 유지(초과분 정리).
        }).then(() => pruneAiChatHistory(userId, MAX_STORED_HISTORY)).catch(() => {});
      }

      // 대화 메타 갱신: 마지막 상태, (없으면) 첫 상황 요약을 제목으로.
      if (conversation) {
        prisma.aiConversation.update({
          where: { id: conversation.id },
          data: {
            lastStatus: result.status,
            ...(conversation.title || !result.situationSummary
              ? {}
              : { title: result.situationSummary.slice(0, 80) }),
          },
        }).catch(() => {});
      }

      res.set('Cache-Control', 'no-store');
      res.json(conversation ? { ...result, conversationId: conversation.id } : result);
    } catch (err) {
      if (dailyReserved) {
        try {
          await refundDailyAiRequest(userId);
        } catch (refundError) {
          console.error('[AI quota refund failed]', refundError);
        }
      }
      next(err);
    }
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const history = await prisma.aiChatHistory.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        question: true,
        situationSummary: true,
        legalAdvice: true,
        suggestions: true,
        createdAt: true,
      },
    });
    res.json(history);
  } catch (err) {
    next(err);
  }
}

// 사용자의 대화 스레드 목록(최근 활동순).
export async function listConversations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversations = await prisma.aiConversation.findMany({
      where: { userId: req.userId! },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        lastStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(conversations);
  } catch (err) {
    next(err);
  }
}

// 단일 대화 스레드 상세(소유자 검증 + 턴 목록).
export async function getConversation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: String(req.params.id), userId: req.userId! },
      select: {
        id: true,
        title: true,
        status: true,
        lastStatus: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
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

    if (!conversation) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (err) {
    next(err);
  }
}
