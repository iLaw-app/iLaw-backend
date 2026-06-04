import OpenAI from 'openai';
import prisma from '../prisma/client';
import { expandQuery } from './synonyms';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 인메모리 캐시 ──────────────────────────────────────────────

type ManualItem = { id: number; question: string; summary: string | null };
type QAItem = { id: number; title: string; content: string };

let manualCache: ManualItem[] = [];

let qaCache: QAItem[] = [];
let qaCacheAt = 0;
const QA_TTL = 60 * 60 * 1000;

export async function loadManualCache() {
  manualCache = await prisma.manualArticle.findMany({
    select: { id: true, question: true, summary: true },
  });
}

async function getQACache(): Promise<QAItem[]> {
  if (Date.now() - qaCacheAt > QA_TTL || qaCache.length === 0) {
    qaCache = await prisma.qnAPost.findMany({
      where: { status: 'answered' },
      select: { id: true, title: true, content: true },
    });
    qaCacheAt = Date.now();
  }
  return qaCache;
}

// ── 키워드 추출 + 사전 필터링 ──────────────────────────────────

function extractKeywords(message: string): string[] {
  const words = message
    .split(/[\s.,!?。、·\-_'"()\[\]{}]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2);
  const terms = new Set<string>();
  for (const word of words) {
    expandQuery(word).forEach(t => terms.add(t));
  }
  return [...terms];
}

function preFilterManuals(manuals: ManualItem[], terms: string[], limit = 8): ManualItem[] {
  if (manuals.length <= limit) return manuals;
  if (terms.length === 0) return manuals.slice(0, limit);
  return manuals
    .map(m => ({
      m,
      score: terms.reduce((acc, t) =>
        acc + (m.question.includes(t) ? 2 : 0) + ((m.summary ?? '').includes(t) ? 1.5 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.m);
}

function preFilterQAs(qas: QAItem[], terms: string[], limit = 8): QAItem[] {
  if (qas.length <= limit) return qas;
  if (terms.length === 0) return qas.slice(0, limit);
  return qas
    .map(q => ({
      q,
      score: terms.reduce((acc, t) =>
        acc + (q.title.includes(t) ? 2 : 0) + (q.content.slice(0, 300).includes(t) ? 1.5 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.q);
}

// ── 메인 로직 ──────────────────────────────────────────────────

type Reference = { type: 'manual' | 'qa'; id: number };

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
  const manuals = manualCache;
  const qaPosts = await getQACache();
  const userLabel = nickname ? `${nickname}님` : '사용자';

  // ── 키워드 기반 사전 필터링 ──
  const keywords = extractKeywords(message);
  const filteredManuals = preFilterManuals(manuals, keywords);
  const filteredQAs = preFilterQAs(qaPosts, keywords);

  // ── GPT 1차: 상황 요약 + 관련 항목 선택 ──
  const manualList = filteredManuals
    .map(m => `[MANUAL id=${m.id}] ${m.question}${m.summary ? ' / ' + m.summary : ''}`)
    .join('\n');
  const qaList = filteredQAs
    .map(q => `[QA id=${q.id}] ${q.title} / ${q.content.slice(0, 200)}`)
    .join('\n');

  const historyMessages = history.flatMap(h => [
    { role: 'user' as const, content: h.question },
    { role: 'assistant' as const, content: h.legalAdvice },
  ]);

  const step1Res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `당신은 법률 정보 서비스의 AI 어시스턴트입니다.
아래 매뉴얼과 Q&A 목록을 읽고 다음을 수행하세요.

1. 사용자 메시지를 아래 두 가지로 분류하세요.
   - "relevant": 본인이 겪고 있는 법률 관련 상황 설명
   - "unrelated": 인사말·잡담·일반 법률 지식 질문·법률과 무관한 내용·상황 설명이 없는 경우

2. status가 "relevant"일 때만: ${userLabel}의 상황을 2~3문장으로 요약하세요. 반드시 "${userLabel}은(는)"으로 시작하세요.
3. status가 "relevant"일 때만: 목록 중 사용자의 상황과 직접적으로 관련된 항목만 최대 3개 골라 ID를 반환하세요.
   - 사용자가 피해자라면 반드시 피해자 입장의 항목을 선택하세요. 가해자·처벌 관련 항목은 제외하세요.
   - 확실하게 관련 있는 항목이 없으면 빈 배열([])을 반환하세요. 억지로 채우지 마세요.

반드시 다음 JSON 형식으로만 응답하세요:
{"status":"relevant","situationSummary":"...","references":[{"type":"manual"|"qa","id":숫자}]}
status가 relevant가 아니면: {"status":"unrelated","situationSummary":"","references":[]}

=== 매뉴얼 목록 ===
${manualList}

=== Q&A 목록 ===
${qaList}`,
      },
      ...historyMessages,
      { role: 'user', content: message },
    ],
  });

  let situationSummary = '';
  let references: Reference[] = [];

  try {
    const parsed = JSON.parse(step1Res.choices[0].message.content ?? '{}');
    const status: string = parsed.status ?? 'unrelated';

    if (status !== 'relevant') {
      return {
        status: 'unrelated',
        situationSummary: '',
        legalAdvice: '저는 법률 관련 상황만 도와드릴 수 있어요. 법률적으로 어려운 상황이 생기면 언제든지 말씀해 주세요.',
        suggestions: [],
        chatEnded: true,
      };
    }

    situationSummary = parsed.situationSummary ?? '';
    references = (parsed.references ?? []).filter(
      (r: any) => (r.type === 'manual' || r.type === 'qa') && typeof r.id === 'number'
    );
  } catch {
    // 파싱 실패 시 references 없이 진행
  }

  // ── 선택된 항목 전체 내용 DB 조회 ──
  const manualRefs = references.filter(r => r.type === 'manual').map(r => r.id);
  const qaRefs = references.filter(r => r.type === 'qa').map(r => r.id);

  const [fullArticles, fullQaPosts] = await Promise.all([
    manualRefs.length > 0
      ? prisma.manualArticle.findMany({
          where: { id: { in: manualRefs } },
          select: { id: true, question: true, content: true },
        })
      : [],
    qaRefs.length > 0
      ? prisma.qnAPost.findMany({
          where: { id: { in: qaRefs } },
          select: {
            id: true, title: true, content: true,
            answer: { select: { content: true } },
          },
        })
      : [],
  ]);

  // ── GPT 2차: 전체 내용 기반 최종 법적 안내 생성 ──
  const contentBlocks = [
    ...fullArticles.map(a => `[매뉴얼] ${a.question}\n${a.content}`),
    ...fullQaPosts.map(q =>
      `[Q&A] ${q.title}\n질문: ${q.content}${q.answer ? '\n변호사 답변: ' + q.answer.content : ''}`
    ),
  ].join('\n\n---\n\n');

  let legalAdvice = '';

  if (contentBlocks) {
    const step2Res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `당신은 법률 정보 서비스의 따뜻한 AI 어시스턴트입니다.
아래 법률 콘텐츠(매뉴얼 본문 및 Q&A 변호사 답변)만을 근거로 안내를 제공하세요.

반드시 다음 순서로 응답하세요:
1. 먼저 ${userLabel}의 상황에 진심으로 공감하는 한 문장으로 시작하세요. (예: "정말 힘드셨겠어요.", "많이 당황스러우셨겠어요.")
2. 이어서 친근하고 따뜻한 말투로 법적 안내를 2~3문장 제공하세요.

제공된 법률 콘텐츠 외의 정보는 사용하지 마세요.
심각한 상황이라면 전문 변호사 상담을 권유하세요.
텍스트로만 응답하세요.

=== 법률 콘텐츠 ===
${contentBlocks}`,
        },
        ...historyMessages,
        { role: 'user', content: message },
      ],
    });
    legalAdvice = step2Res.choices[0].message.content?.trim() ?? '';
  }

  // ── 응답 조합 ──
  const suggestions = references
    .map(ref => {
      const label =
        ref.type === 'manual'
          ? manuals.find(m => m.id === ref.id)?.question
          : qaPosts.find(q => q.id === ref.id)?.title;
      return label ? { type: ref.type, id: ref.id, label } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return { status: 'relevant', situationSummary, legalAdvice, suggestions, chatEnded: true };
}
