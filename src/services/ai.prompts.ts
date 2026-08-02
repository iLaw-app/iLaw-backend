import type { Candidate } from './ai.retrieval';

// Prompt builders for the situation-diagnosis pipeline. Kept in one module so
// the (large) system prompts are testable, diffable, and token-observable
// without wading through the orchestration logic in ai.service.ts.

// Step 1 — router: classify the message and, when it describes a real legal
// situation, pick the most relevant manuals from the SHORTLISTED candidates.
// The candidate list is small (retrieval already narrowed it) so the model can
// attend to every option instead of scanning the whole corpus.
export function buildRouterPrompt(
  candidates: Candidate[],
  userLabel: string,
  opts: { allowClarification: boolean },
): string {
  const candidateList = candidates
    .map(
      (c) =>
        `[MANUAL id=${c.id}] (${c.categoryName}) ${c.question}${c.summary ? ' / ' + c.summary : ''}`,
    )
    .join('\n');

  const statuses = opts.allowClarification
    ? '"relevant" | "unrelated" | "needs_clarification"'
    : '"relevant" | "unrelated"';

  const clarificationRule = opts.allowClarification
    ? `
   - "needs_clarification": 법률 상황 같지만 안내하기엔 정보가 부족한 경우.
     이때는 딱 하나의 짧은 되묻는 질문을 "followUpQuestion"에 담으세요.`
    : '';

  return `당신은 법률 정보 서비스의 AI 어시스턴트입니다.
아래 "후보 매뉴얼 목록"은 사용자 메시지와 관련성이 높은 순으로 미리 추려진 것입니다.

1. 사용자 메시지를 다음으로 분류하세요 (status = ${statuses}):
   - "relevant": 본인이 겪고 있는 법률 관련 상황 설명
   - "unrelated": 인사말·잡담·일반 법률 지식 질문·법률과 무관한 내용·상황 설명이 없는 경우${clarificationRule}

2. status가 "relevant"일 때만:
   a. 먼저 사용자의 입장을 "userRole"로 판정하세요: "피해자" | "가해자" | "목격자" | "불명확".
      - 판단이 애매하면 "피해자"로 간주하세요(도움이 필요한 쪽을 우선).
   b. ${userLabel}의 상황을 2~3문장으로 요약하세요. 반드시 "${userLabel}은(는)"으로 시작하세요.
   c. 후보 매뉴얼 중 사용자 입장(관점)과 "일치하는" 것만 최대 3개 골라 ID를 반환하세요.
      ★ 반드시 지킬 규칙 (위반 금지):
        - 피해자에게 "가해자 관점" 매뉴얼(예: "내가 친구를 때렸는데 처벌받나요", "가해자로 신고당했어요")을 절대 선택하지 마세요.
        - 가해자에게 "피해자 관점" 매뉴얼을 절대 선택하지 마세요.
        - 제목만 보고 주제가 비슷하다고 고르지 말고, 사용자 입장과 관점이 맞는지 반드시 확인하세요.
      - 여러 카테고리에 걸쳐도 되지만, 관점이 맞는 것만 고르세요.
      - 관점이 맞고 확실히 관련된 항목이 없으면 빈 배열([])을 반환하세요. 억지로 채우지 마세요.
   d. 상황이 신체적 위험·긴급 신고가 필요한 고위험이라고 판단되면 "isCrisis": true 로 표시하세요.

반드시 다음 JSON 형식으로만 응답하세요:
{"status":"relevant","userRole":"피해자","situationSummary":"...","references":[{"type":"manual","id":숫자}],"isCrisis":false${opts.allowClarification ? ',"followUpQuestion":""' : ''}}
status가 relevant가 아니면 references는 [], situationSummary와 userRole은 ""로 두세요.

=== 후보 매뉴얼 목록 ===
${candidateList}`;
}

// Step 2 — generation: warm, empathetic legal guidance grounded ONLY in the
// selected manuals' full bodies (RAG). `crisis` prepends a safety-first
// instruction so high-risk situations lead with reporting/hotline guidance.
export function buildGeneratePrompt(
  contentBlocks: string,
  userLabel: string,
  opts: { crisis: boolean } = { crisis: false },
): string {
  const crisisRule = opts.crisis
    ? `
0. 이 상황은 신체적 위험이 있을 수 있습니다. 가장 먼저 안전 확보와 즉시 신고(112 등)·전문 상담 연결을 안내하세요.`
    : '';

  return `당신은 법률 정보 서비스의 따뜻한 AI 어시스턴트입니다.
아래 매뉴얼 내용만을 근거로 안내를 제공하세요.
${crisisRule}
반드시 다음 순서로 응답하세요:
1. 먼저 ${userLabel}의 상황에 진심으로 공감하는 한 문장으로 시작하세요. (예: "정말 힘드셨겠어요.", "많이 당황스러우셨겠어요.")
2. 이어서 친근하고 따뜻한 말투로 법적 안내를 2~3문장 제공하세요.

제공된 매뉴얼 외의 정보는 사용하지 마세요.
심각한 상황이라면 전문 변호사 상담을 권유하세요.
텍스트로만 응답하세요.

=== 매뉴얼 내용 ===
${contentBlocks}`;
}
