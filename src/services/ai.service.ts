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

export async function diagnose(message: string, nickname?: string): Promise<{
  situationSummary: string;
  legalAdvice: string;
  suggestions: { type: 'manual' | 'qa'; id: number; label: string }[];
}> {
  const manuals = manualCache;
  const qaPosts = await getQACache();
  const userLabel = nickname ? `${nickname}님` : '사용자';

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
아래 매뉴얼과 Q&A 목록을 읽고 세 가지를 수행하세요.
1. 사용자 메시지가 본인이 겪고 있는 법률 관련 상황 설명인지 판단하세요. 인사말·잡담·일반 법률 지식 질문·무관한 내용이면 false, 본인 상황이면 true입니다.
2. isRelevant가 true일 때만: ${userLabel}의 상황을 2~3문장으로 요약하세요. 반드시 "${userLabel}은(는)"으로 시작하세요.
3. isRelevant가 true일 때만: 목록 중 실제로 관련 있는 항목을 최대 3개 골라 ID를 반환하세요.

반드시 다음 JSON 형식으로만 응답하세요:
{"isRelevant":true,"situationSummary":"...","references":[{"type":"manual"|"qa","id":숫자}]}
isRelevant가 false이면: {"isRelevant":false,"situationSummary":"","references":[]}

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

    if (parsed.isRelevant === false) {
      return {
        situationSummary: '',
        legalAdvice: `${userLabel}의 상황을 좀 더 자세히 말씀해 주시면 도움을 드릴 수 있어요!\n\n예를 들어 이렇게 알려주세요:\n• 어떤 일이 있었는지\n• 상대방이 누구인지 (사장님, 집주인, 친구 등)\n• 어떻게 해결하고 싶은지`,
        suggestions: [],
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
