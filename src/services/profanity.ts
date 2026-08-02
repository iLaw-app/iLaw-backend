// 로컬 금칙어 사전 (1차 필터, 동기 하드블록).
// 명백한 비속어만 여기서 즉시 차단하고, 문맥/우회 표현은 2차 OpenAI Moderation이 게시 후 잡는다.
// 운영하며 목록을 늘려가는 것을 전제로 한다.

const BLOCKLIST = [
  // 완성형
  '시발', '씨발', '씨팔', '시팔', '씨바', '개새끼', '개색끼', '개세끼',
  '병신', '븅신', '지랄', '좆', '좆같', '존나', '개년', '개놈',
  '니미', '니애미', '느금마', '엠창', '창녀', '보지', '자지',
  '섹스', '창놈', '썅', '쌍놈', '쌍년', '미친놈', '미친년',
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy',
  // 초성 축약 (커뮤니티 우회 표현). 단일 초성은 오탐이 크므로 2자 이상만.
  'ㅅㅂ', 'ㅆㅂ', 'ㅄ', 'ㅂㅅ', 'ㅈㄴ', 'ㅈㄹ', 'ㅁㅊ',
  'ㄱㅅㄲ', 'ㄲㅈ', 'ㄷㅊ', 'ㄴㄱㅁ',
];

// 우회 표현 대응: 공백/특수문자/반복문자를 제거하고 소문자화해 정규화한다.
// (예: "시 발", "시-발", "시이발" → "시발")
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s~!@#$%^&*()_\-+=|\\/.,<>?;:'"`[\]{}]/g, '')
    .replace(/(.)\1+/g, '$1'); // 3연속 이상 반복문자 축약
}

const NORMALIZED_BLOCKLIST = BLOCKLIST.map(normalize);

// 로컬 사전에 걸리는 명백한 비속어가 있으면 true.
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalize(text);
  return NORMALIZED_BLOCKLIST.some((word) => word.length > 0 && normalized.includes(word));
}
