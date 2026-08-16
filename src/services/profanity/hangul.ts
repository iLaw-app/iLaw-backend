// 한글 자모 분해 유틸. 금칙어 엔진(profanity)의 자모 뷰를 만들 때 사용한다.
//
// 표현 규칙
// - 초성/중성: 호환 자모(U+3131~U+3163, 'ㄱ'~'ㅣ')로 표현한다. 사용자가 직접 타이핑한
//   'ㅅㅐ끼' 같은 낱자모도 같은 문자로 합쳐지므로 변형이 한 규칙으로 잡힌다.
// - 종성: 초성과 구분하기 위해 조합용 종성(U+11A8~U+11C2)으로 표현한다.
//   그래야 '좆'(ㅈㅗ+종성ㅈ)이 '조직'(ㅈㅗ+초성ㅈ+ㅣ+…)과 섞이지 않는다.

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'; // index 0 = 받침 없음

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_END = 0xd7a3;
const CONJOINING_JONG_BASE = 0x11a7; // + JONG index (1..27)

export const COMPAT_VOWEL_CLASS = '[ㅏ-ㅣ]';

export function isHangulSyllable(cp: number): boolean {
  return cp >= SYLLABLE_BASE && cp <= SYLLABLE_END;
}

export function isCompatJamo(cp: number): boolean {
  return cp >= 0x3131 && cp <= 0x3163;
}

export function isCompatVowel(cp: number): boolean {
  return cp >= 0x314f && cp <= 0x3163;
}

// 호환 자모 자음('ㄱ'…'ㅎ', 겹받침 포함) → 조합용 종성 문자. 종성이 될 수 없는 자음(ㄸ ㅃ ㅉ)은 null.
export function toJongseong(compatConsonant: string): string | null {
  const idx = JONG.indexOf(compatConsonant);
  if (idx <= 0) return null;
  return String.fromCharCode(CONJOINING_JONG_BASE + idx);
}

// 완성형 음절 → [초성, 중성, 종성?] (초·중성은 호환 자모, 종성은 조합용 종성).
export function decomposeSyllable(cp: number): string[] {
  const offset = cp - SYLLABLE_BASE;
  const cho = Math.floor(offset / 588);
  const jung = Math.floor((offset % 588) / 28);
  const jong = offset % 28;
  const out = [CHO[cho], JUNG[jung]];
  if (jong > 0) out.push(String.fromCharCode(CONJOINING_JONG_BASE + jong));
  return out;
}

// NFKC 등으로 튀어나온 조합용 자모(U+1100~U+11FF)를 호환 자모로 되돌린다.
// 종성도 호환 자모 자음으로 되돌린다(직접 타이핑한 낱자모와 동일 취급).
export function conjoiningToCompat(cp: number): string | null {
  if (cp >= 0x1100 && cp <= 0x1112) return CHO[cp - 0x1100];
  if (cp >= 0x1161 && cp <= 0x1175) return JUNG[cp - 0x1161];
  if (cp >= 0x11a8 && cp <= 0x11c2) return JONG[cp - CONJOINING_JONG_BASE];
  return null;
}
