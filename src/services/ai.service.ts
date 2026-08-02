import OpenAI from 'openai';
import prisma from '../prisma/client';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEFAULT_DAILY_REQUEST_LIMIT = 10;
const DEFAULT_BURST_REQUEST_LIMIT = 3;
const DEFAULT_OPENAI_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_COMPLETION_TOKENS = 600;
const BURST_WINDOW_MS = 60_000;

type BurstWindow = { startedAt: number; count: number };
const burstWindows = new Map<string, BurstWindow>();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function secondsUntilNextUtcDay(now: Date): number {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 1_000));
}

export function consumeAiBurstSlot(
  userId: string,
  nowMs = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const limit = positiveInteger(process.env.AI_BURST_REQUEST_LIMIT, DEFAULT_BURST_REQUEST_LIMIT);
  const current = burstWindows.get(userId);

  if (!current || nowMs - current.startedAt >= BURST_WINDOW_MS) {
    burstWindows.set(userId, { startedAt: nowMs, count: 1 });
    return { allowed: true };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + BURST_WINDOW_MS - nowMs) / 1_000)),
    };
  }

  current.count += 1;
  return { allowed: true };
}

export function refundAiBurstSlot(userId: string): void {
  const current = burstWindows.get(userId);
  if (!current) return;
  current.count = Math.max(0, current.count - 1);
  if (current.count === 0) burstWindows.delete(userId);
}

export function resetAiBurstLimits(): void {
  burstWindows.clear();
}

export async function reserveDailyAiRequest(
  userId: string,
  now = new Date(),
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const date = utcDayStart(now);
  const limit = positiveInteger(process.env.AI_DAILY_REQUEST_LIMIT, DEFAULT_DAILY_REQUEST_LIMIT);

  const reservation = await prisma.$transaction(async tx => {
    await tx.aiDailyUsage.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, requestCount: 0 },
      update: {},
    });
    return tx.aiDailyUsage.updateMany({
      where: { userId, date, requestCount: { lt: limit } },
      data: { requestCount: { increment: 1 } },
    });
  });

  return reservation.count === 1
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: secondsUntilNextUtcDay(now) };
}

export async function refundDailyAiRequest(userId: string, now = new Date()): Promise<void> {
  await prisma.aiDailyUsage.updateMany({
    where: { userId, date: utcDayStart(now), requestCount: { gt: 0 } },
    data: { requestCount: { decrement: 1 } },
  });
}

function openAiRequestOptions() {
  return { timeout: positiveInteger(process.env.AI_OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS) };
}

function maxCompletionTokens(): number {
  return positiveInteger(process.env.AI_MAX_COMPLETION_TOKENS, DEFAULT_MAX_COMPLETION_TOKENS);
}

// ── 인메모리 캐시 ──────────────────────────────────────────────

type ManualItem = {
  id: number;
  question: string;
  summary: string | null;
  categorySlug: string;
  categoryName: string;
};

type ManualsByCategory = Record<string, { name: string; items: ManualItem[] }>;

let manualCache: ManualItem[] = [];
let manualsByCategory: ManualsByCategory = {};

export async function loadManualCache() {
  manualCache = await prisma.manualArticle.findMany({
    select: {
      id: true,
      question: true,
      summary: true,
      category: { select: { slug: true, name: true } },
    },
  }).then(rows => rows.map(r => ({
    id: r.id,
    question: r.question,
    summary: r.summary,
    categorySlug: r.category.slug,
    categoryName: r.category.name,
  })));

  // 카테고리별 그룹화
  manualsByCategory = {};
  for (const m of manualCache) {
    if (!manualsByCategory[m.categorySlug]) {
      manualsByCategory[m.categorySlug] = { name: m.categoryName, items: [] };
    }
    manualsByCategory[m.categorySlug].items.push(m);
  }
}

// ── 메인 로직 ──────────────────────────────────────────────────

export async function diagnose(
  message: string,
  nickname?: string,
  history: { question: string; legalAdvice: string }[] = [],
): Promise<{
  status: 'relevant' | 'unrelated';
  situationSummary: string;
  legalAdvice: string;
  suggestions: { type: 'manual' | 'qa'; id: number; label: string }[];
  chatEnded: boolean;
}> {
  const userLabel = nickname ? `${nickname}님` : '사용자';

  // ── STEP 1용: 카테고리별 제목+summary 목록 구성 ──
  const manualList = Object.entries(manualsByCategory)
    .map(([slug, { name, items }]) => {
      const lines = items
        .map(m => `[MANUAL id=${m.id}] ${m.question}${m.summary ? ' / ' + m.summary : ''}`)
        .join('\n');
      return `=== ${name} (${slug}) ===\n${lines}`;
    })
    .join('\n\n');

  const historyMessages = history.flatMap(h => [
    { role: 'user' as const, content: h.question },
    { role: 'assistant' as const, content: h.legalAdvice },
  ]);

  // ── GPT 1차: 분류 + 카테고리 선택 + 카테고리 내 매뉴얼 최대 3개 선택 ──
  const step1Res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_completion_tokens: maxCompletionTokens(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `당신은 법률 정보 서비스의 AI 어시스턴트입니다.
아래 카테고리별 매뉴얼 목록을 읽고 다음을 수행하세요.

1. 사용자 메시지를 아래 두 가지로 분류하세요.
   - "relevant": 본인이 겪고 있는 법률 관련 상황 설명
   - "unrelated": 인사말·잡담·일반 법률 지식 질문·법률과 무관한 내용·상황 설명이 없는 경우

2. status가 "relevant"일 때만:
   a. ${userLabel}의 상황을 2~3문장으로 요약하세요. 반드시 "${userLabel}은(는)"으로 시작하세요.
   b. 사용자 상황에 가장 적합한 카테고리 slug를 하나 선택하세요.
   c. 선택한 카테고리 내에서 사용자 상황과 가장 직접적으로 관련된 매뉴얼을 최대 3개 골라 ID를 반환하세요.
      - 사용자가 피해자라면 피해자 입장의 항목을, 가해자이거나 처벌이 궁금한 경우라면 그에 맞는 항목을 선택하세요.
      - 확실하게 관련 있는 항목이 없으면 빈 배열([])을 반환하세요. 억지로 채우지 마세요.

반드시 다음 JSON 형식으로만 응답하세요:
{"status":"relevant","categorySlug":"슬러그","situationSummary":"...","references":[{"type":"manual","id":숫자}]}
status가 relevant가 아니면: {"status":"unrelated","categorySlug":"","situationSummary":"","references":[]}

=== 매뉴얼 목록 ===
${manualList}`,
      },
      ...historyMessages,
      { role: 'user', content: message },
    ],
  }, openAiRequestOptions());

  let situationSummary = '';
  let categorySlug = '';
  let selectedIds: number[] = [];

  try {
    const parsed = JSON.parse(step1Res.choices[0].message.content ?? '{}');

    if (parsed.status !== 'relevant') {
      return {
        status: 'unrelated',
        situationSummary: '',
        legalAdvice: '저는 법률 관련 상황만 도와드릴 수 있어요. 법률적으로 어려운 상황이 생기면 언제든지 말씀해 주세요.',
        suggestions: [],
        chatEnded: true,
      };
    }

    situationSummary = parsed.situationSummary ?? '';
    categorySlug = parsed.categorySlug ?? '';
    selectedIds = (parsed.references ?? [])
      .filter((r: any) => r.type === 'manual' && typeof r.id === 'number')
      .map((r: any) => r.id as number);

    console.log('[AI] category:', categorySlug, '/ selected manuals:', selectedIds);
  } catch {
    // 파싱 실패 시 빈 선택으로 진행
  }

  // ── 선택된 매뉴얼 전체 내용 DB 조회 ──
  const fullArticles = selectedIds.length > 0
    ? await prisma.manualArticle.findMany({
        where: { id: { in: selectedIds } },
        select: { id: true, question: true, content: true },
      })
    : [];

  // ── GPT 2차: 선택된 매뉴얼 전체 내용 기반 법적 안내 생성 ──
  const contentBlocks = fullArticles
    .map(a => `[매뉴얼] ${a.question}\n${a.content}`)
    .join('\n\n---\n\n');

  let legalAdvice = '';

  if (contentBlocks) {
    const step2Res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_completion_tokens: maxCompletionTokens(),
      messages: [
        {
          role: 'system',
          content: `당신은 법률 정보 서비스의 따뜻한 AI 어시스턴트입니다.
아래 매뉴얼 내용만을 근거로 안내를 제공하세요.

반드시 다음 순서로 응답하세요:
1. 먼저 ${userLabel}의 상황에 진심으로 공감하는 한 문장으로 시작하세요. (예: "정말 힘드셨겠어요.", "많이 당황스러우셨겠어요.")
2. 이어서 친근하고 따뜻한 말투로 법적 안내를 2~3문장 제공하세요.

제공된 매뉴얼 외의 정보는 사용하지 마세요.
심각한 상황이라면 전문 변호사 상담을 권유하세요.
텍스트로만 응답하세요.

=== 매뉴얼 내용 ===
${contentBlocks}`,
        },
        ...historyMessages,
        { role: 'user', content: message },
      ],
    }, openAiRequestOptions());
    legalAdvice = step2Res.choices[0].message.content?.trim() ?? '';
  }

  // ── suggestions: 선택된 매뉴얼 반환 ──
  const categoryItems = manualsByCategory[categorySlug]?.items ?? [];
  const suggestions = selectedIds
    .map(id => {
      const label = categoryItems.find(m => m.id === id)?.question;
      return label ? { type: 'manual' as const, id, label } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return { status: 'relevant', situationSummary, legalAdvice, suggestions, chatEnded: true };
}
