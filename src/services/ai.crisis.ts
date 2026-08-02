// 위기(고위험) 상황 감지 + 긴급 핫라인 안내.
//
// 설계 원칙: "차단"이 아니라 "안전 정보를 추가로 노출"하는 안전 지향. 오탐이
// 있어도 핫라인이 하나 더 보이는 정도이므로, 키워드는 넉넉히 잡는다. 최종
// 위기 판정은 이 룰과 라우터 LLM의 isCrisis 신호를 함께 사용(이중 판정)한다.

export interface Hotline {
  label: string;
  phone: string;
}

// 카테고리와 무관하게 항상 노출되는 공통 긴급 연락처.
const COMMON_HOTLINES: Hotline[] = [
  { label: '긴급신고(범죄·위급)', phone: '112' },
  { label: '응급의료·구조', phone: '119' },
  { label: '자살예방상담', phone: '1393' },
];

// 카테고리 slug별 전문 핫라인.
const CATEGORY_HOTLINES: Record<string, Hotline[]> = {
  'child-abuse': [
    { label: '아동학대 신고', phone: '112' },
    { label: '아동보호전문기관', phone: '1391' },
  ],
  'sexual-violence': [
    { label: '여성긴급전화', phone: '1366' },
    { label: '해바라기센터(성폭력 피해)', phone: '1899-3075' },
  ],
  'school-violence': [{ label: '학교폭력 신고', phone: '117' }],
  'online-violence': [
    { label: '디지털성범죄피해자지원센터', phone: '02-735-8994' },
    { label: '사이버범죄 신고(경찰)', phone: '182' },
  ],
};

// 고위험 신호 키워드(안전 지향으로 넓게). 표현 변형까지 정밀하게 잡지는 않되,
// 명백한 물리적 위험·자·타해 신호를 포괄한다.
const CRISIS_KEYWORDS = [
  '때리', '때려', '때렸', '때린', '맞았', '맞고', '맞아', '폭행', '흉기', '칼', '피가',
  '죽', '자살', '감금', '가두', '협박', '강간', '성폭행', '추행',
  '스토킹', '학대', '목 졸', '위협', '살해', '죽이',
];

export interface CrisisResult {
  level: 'high' | 'none';
  hotlines: Hotline[];
}

// 주어진 카테고리들의 전문 핫라인 + 공통 핫라인을 전화번호 기준 중복 제거해 반환.
export function hotlinesFor(categorySlugs: string[]): Hotline[] {
  const out: Hotline[] = [];
  const seen = new Set<string>();
  const push = (h: Hotline) => {
    if (seen.has(h.phone)) return;
    seen.add(h.phone);
    out.push(h);
  };
  for (const slug of categorySlugs) (CATEGORY_HOTLINES[slug] ?? []).forEach(push);
  COMMON_HOTLINES.forEach(push);
  return out;
}

// 룰 기반 위기 감지. categorySlugs가 주어지면 해당 카테고리 핫라인을 함께 구성.
export function detectCrisis(message: string, categorySlugs: string[] = []): CrisisResult {
  const high = CRISIS_KEYWORDS.some((kw) => message.includes(kw));
  return { level: high ? 'high' : 'none', hotlines: hotlinesFor(categorySlugs) };
}
