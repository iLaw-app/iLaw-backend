import OpenAI from 'openai';
import prisma from '../prisma/client';

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

// ── 메인 로직 ──────────────────────────────────────────────────

type Reference = { type: 'manual' | 'qa'; id: number };

export async function diagnose(message: string): Promise<{
  situationSummary: string;
  legalAdvice: string;
  suggestions: { type: 'manual' | 'qa'; id: number; label: string }[];
}> {
  const manuals = manualCache;
  const qaPosts = await getQACache();

  // ── GPT 1차: 상황 요약 + 관련 항목 선택 ──
  const manualList = manuals
    .map(m => `[MANUAL id=${m.id}] ${m.question}${m.summary ? ' / ' + m.summary : ''}`)
    .join('\n');
  const qaList = qaPosts
    .map(q => `[QA id=${q.id}] ${q.title} / ${q.content.slice(0, 200)}`)
    .join('\n');

  const step1Res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `당신은 법률 정보 서비스의 AI 어시스턴트입니다.
아래 매뉴얼과 Q&A 목록을 읽고 두 가지를 수행하세요.
1. 사용자 상황을 2~3문장으로 요약하세요.
2. 목록 중 사용자 상황과 실제로 관련 있는 항목을 최대 3개 골라 ID를 반환하세요. 관련 없으면 더 적게 선택해도 됩니다.

반드시 다음 JSON 형식으로만 응답하세요:
{"situationSummary":"...","references":[{"type":"manual"|"qa","id":숫자}]}

=== 매뉴얼 목록 ===
${manualList}

=== Q&A 목록 ===
${qaList}`,
      },
      { role: 'user', content: message },
    ],
  });

  let situationSummary = '';
  let references: Reference[] = [];

  try {
    const parsed = JSON.parse(step1Res.choices[0].message.content ?? '{}');
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
          content: `당신은 법률 정보 서비스의 AI 어시스턴트입니다.
아래 법률 콘텐츠(매뉴얼 본문 및 Q&A 변호사 답변)만을 근거로 사용자 상황에 법적 안내를 2~4문장으로 제공하세요.
제공된 내용 외의 정보는 사용하지 마세요.
심각한 상황이라면 전문 변호사 상담을 권유하세요.
텍스트로만 응답하세요.

=== 법률 콘텐츠 ===
${contentBlocks}`,
        },
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

  return { situationSummary, legalAdvice, suggestions };
}
