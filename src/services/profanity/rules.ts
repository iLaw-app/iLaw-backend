// 금칙어 규칙 사전. 엔진(engine.ts)이 만든 정규화 뷰 위에서 매칭된다.
//
// 뷰(view)
// - jamo   : 공백·구두점·숫자 제거, 유사문자(l/|→ㅣ) 치환, 음절을 자모로 분해. 변형 표기 대응용.
// - compact: 공백·구두점·숫자·라틴 제거, 음절은 그대로. 초성 축약(ㅅㅂ) 전용 — 자모 분해하면 '옷보'가 ㅅㅂ로 오탐된다.
// - digits : compact + 숫자 유지. '씨8', '18놈'처럼 숫자를 문자로 쓰는 표기 전용.
// - latin  : 라틴+숫자만 남기고 leet(1→i, 3→e…) 치환, 공백 제거, 반복문자 축약. 영어 욕설·로마자·한영키 오타.
// - word   : 라틴+숫자만 남기되 그 외 문자는 단어 경계로 유지. 짧아서 부분일치가 위험한 영단어(dick, ass) 전용.
//
// jamo 패턴 표기법
// - 호환 자모를 그대로 쓴다. 종성은 <ㄹ> 처럼 꺾쇠로 감싼다(<[ㄹㅁ]> 클래스 가능).
//   <ㄹ>은 "종성 ㄹ" 또는 "모음이 뒤따르지 않는 낱자모 ㄹ"(ㅅㅣㅂㅏㄹ 처럼 타이핑한 경우)에 매칭된다.
// - 낱자모 초성 뒤에는 실제 음절에서 항상 모음이 오므로, 자음-자음 연쇄는 사용자가 낱자모를 타이핑한 경우뿐이다.
//
// 후처리 옵션 (engine.ts에서 원문 기준으로 검사)
// - contiguous : 원문에서 매치 구간에 공백이 있으면 무시. ('개 같이 산책' vs '개같은')
// - tokenStart : 매치가 어절 시작이어야 함(prefix 로 허용 접두 지정 가능). ('전염병' vs '염병')
// - tokenEnd   : 매치가 어절 끝이어야 함.
// - notPreceded: 앞 문맥이 이 정규식에 걸리면 무시. ('5개년')
//
// 공백을 가로지르는 매치는 엔진이 "마지막 조각을 제외한 모든 조각이 온전한 어절"인지 검사한다.
// 그래서 '시 발'은 잡히고 '당시 발생'은 잡히지 않는다.

import { COMPAT_VOWEL_CLASS, toJongseong } from './hangul';

export type ViewName = 'jamo' | 'compact' | 'digits' | 'latin' | 'word';

export interface Rule {
  view: ViewName;
  label: string;
  re: RegExp;
  contiguous?: boolean;
  tokenStart?: boolean;
  tokenEnd?: boolean;
  prefix?: RegExp;
  notPreceded?: RegExp;
}

type RuleOptions = Omit<Rule, 'view' | 'label' | 're'>;

const V = COMPAT_VOWEL_CLASS;
// 시발 계열 첫 모음(시/씨/쒸/씌/슈/쓰/샤/쌰/쉬) 과 두 번째 모음(발/벌/불/봘/붤/블)
const V_SI = '[ㅣㅢㅠㅑㅕㅛㅟㅡ]';
const V_BAL = '[ㅏㅓㅗㅜㅘㅝㅡ]';

// <ㄹ> / <[ㄹㅁ]> → 종성 문자 또는 모음이 뒤따르지 않는 낱자모.
function compileJamo(src: string): RegExp {
  const compiled = src.replace(/<(\[[ㄱ-ㅎ]+\]|[ㄱ-ㅎ])>/g, (_m, inner: string) => {
    const consonants = inner.startsWith('[') ? inner.slice(1, -1) : inner;
    const jong = Array.from(consonants)
      .map((c) => toJongseong(c))
      .filter((c): c is string => c !== null)
      .join('');
    return `(?:[${jong}]|[${consonants}](?!${V}))`;
  });
  return new RegExp(compiled, 'g');
}

function jamo(label: string, src: string, opts: RuleOptions = {}): Rule {
  return { view: 'jamo', label, re: compileJamo(src), ...opts };
}

function compact(label: string, src: string, opts: RuleOptions = {}): Rule {
  return { view: 'compact', label, re: new RegExp(src, 'g'), ...opts };
}

function digits(label: string, src: string, opts: RuleOptions = {}): Rule {
  return { view: 'digits', label, re: new RegExp(src, 'g'), ...opts };
}

// 반복문자 축약(latin 뷰와 동일 규칙)을 단어에도 적용해 뷰와 표기를 맞춘다.
export function collapseRepeats(s: string): string {
  return s.replace(/(.)\1+/gu, '$1');
}

function latin(label: string, words: string[], opts: RuleOptions = {}): Rule {
  const alternation = words.map((w) => collapseRepeats(w.toLowerCase())).join('|');
  return { view: 'latin', label, re: new RegExp(`(?:${alternation})`, 'g'), ...opts };
}

function word(label: string, words: string[], opts: RuleOptions = {}): Rule {
  const alternation = words.map((w) => w.toLowerCase()).join('|');
  return { view: 'word', label, re: new RegExp(`(?<![a-z])(?:${alternation})(?![a-z])`, 'g'), ...opts };
}

// 시발 계열: 시발 씨발 씨팔 시팔 쒸발 씌발 싀발 슈발 쓰발 시벌 씨불 시봘 시빨 쓰바 씨바 시부랄 ㅅ발 ㅆ발 ㅅㅣㅂㅏㄹ
const SIBAL: Rule[] = [
  jamo('시발', `[ㅅㅆ]${V_SI}?[ㅂㅃㅍ]${V_BAL}<ㄹ>`),
  jamo('시발', `[ㅅㅆ]${V_SI}ㅇ[ㅣㅢㅡ][ㅂㅃㅍ]${V_BAL}<ㄹ>`, { contiguous: true }), // 시이발 (늘려 쓰기)
  jamo('시발', `[ㅅㅆ]${V_SI}?[ㅂㅃㅍ]${V_BAL}ㅇ${V_BAL}<ㄹ>`, { contiguous: true }), // 시바알
  jamo('시부랄', `[ㅅㅆ]${V_SI}?ㅂㅜㄹ[ㅏㅓ]<ㄹ>`),
  jamo('씨바', `ㅆ${V_SI}?[ㅂㅃㅍ]${V_BAL}`),
  jamo('시빨', `[ㅅㅆ]${V_SI}?ㅃ${V_BAL}`),
  jamo('쌰갈', `ㅆ[ㅑㅕㅛㅠㅣㅢ]?ㄱ[ㅏㅓㅜ]<ㄹ>`),
  jamo('썅', 'ㅆㅑ<ㅇ>'),
  jamo('쌍놈', 'ㅆㅏ<ㅇ>ㄴ(?:ㅗ<ㅁ>|ㅕ<ㄴ>)'),
];

const INSULTS: Rule[] = [
  jamo('개새끼', 'ㄱㅐ[ㅅㅆ][ㅐㅔㅒㅖ]<ㄱ>?[ㄱㄲ][ㅣㅢ]'),
  jamo('개새', 'ㄱㅐ[ㅅㅆ]ㅐ', { contiguous: true, tokenEnd: true }),
  jamo('새끼', '[ㅅㅆ][ㅐㅒ]<ㄱ>?ㄲ[ㅣㅢ]'),
  jamo('십새끼', 'ㅅㅣ<ㅂ>[ㅅㅆ][ㅐㅒ]'),
  jamo('씹', 'ㅆㅣ<ㅂ>(?:[ㅅㅆ][ㅐㅔㅒㅖ]|ㄴㅕ<ㄴ>|ㄴㅗ<ㅁ>|ㅊㅏ<ㅇ>|ㅌ[ㅐㅔ]|ㅈㅣ<ㄹ>)'),
  jamo('병신', 'ㅂ[ㅕㅣㅑㅡㅠ]<ㅇ>[ㅅㅆ][ㅣㅢ]<ㄴ>'),
  jamo('지랄', 'ㅈ[ㅣㅢ]ㄹ[ㅏㅓㅗ]<ㄹ>'),
  jamo('존나', 'ㅈ[ㅗㅡㅜ]<ㄴ>ㄴ[ㅏㅐㅔㅣ]'),
  jamo('조낸', 'ㅈㅗㄴㅐ<ㄴ>'),
  jamo('좆', 'ㅈㅗ<[ㅈㅅ]>'),
  jamo('좆같', 'ㅈ(?:ㅗ<[ㅈㅅ]>)?ㄱㅏ<ㅌ>'),
  jamo('개년', 'ㄱㅐㄴㅕ<ㄴ>', { notPreceded: /\d\s*$/ }),
  jamo('개놈', 'ㄱㅐㄴㅗ<ㅁ>'),
  jamo('개같', 'ㄱㅐㄱㅏ<ㅌ>', { contiguous: true }),
  jamo('미친놈', 'ㅁㅣㅊㅣ<ㄴ>(?:ㄴㅗ<ㅁ>|ㄴㅕ<ㄴ>|[ㅅㅆ][ㅐㅔ]<ㄱ>?ㄲㅣ)'),
  jamo('니미', 'ㄴ[ㅣㅡ]ㅁㅣ(?:ㄹ[ㅓㅏㅣ]<ㄹ>|ㅆ)'),
  jamo('니미', 'ㄴㅣㅁㅣ', { tokenStart: true, tokenEnd: true }),
  jamo('니애미', 'ㄴ[ㅣㅡ](?:ㄱㅡ)?ㅇ[ㅐㅔ](?:ㅁ|<ㅁ>)'),
  jamo('느금', 'ㄴㅡㄱㅡ<ㅁ>'),
  jamo('엠창', 'ㅇ[ㅐㅔ]<ㅁ>(?:ㅊㅏ<ㅇ>|[ㅅㅆ]ㅐ<ㅇ>)'),
  jamo('애미', 'ㅇ[ㅐㅔ][ㅁㅂ]ㅣ(?:ㅇㅓ<[ㅄㅂ]>|ㄷㅟ|ㅈㅜ<ㄱ>)'),
  jamo('창녀', 'ㅊㅏ<ㅇ>(?:ㄴㅕ(?:<ㄴ>|(?!<ㅇ>))|ㄴㅗ<ㅁ>)', { contiguous: true }),
  jamo('등신', 'ㄷㅡ<ㅇ>[ㅅㅆ]ㅣ<ㄴ>', { contiguous: true }),
  jamo('또라이', 'ㄸㅗ(?:ㄹㅏ|<ㄹ>ㅇㅏ)ㅇㅣ', { contiguous: true }),
  jamo('찐따', 'ㅉㅣ<ㄴ>ㄸㅏ'),
  jamo('호로', 'ㅎ[ㅗㅜ]ㄹ[ㅗㅔ](?:[ㅅㅆ][ㅐㅔ]<ㄱ>?ㄲㅣ|ㅈㅏ[ㅅㅆ]ㅣ<ㄱ>)', { contiguous: true }),
  jamo('염병', 'ㅇ[ㅕㅖ]<ㅁ>ㅂㅕ<ㅇ>', { contiguous: true, tokenStart: true }),
  jamo('섹스', '[ㅅㅆ]ㅔ<ㄱ>[ㅅㅆ]ㅡ'),
  // 보지/자지: '보지 못했다', '자지 않았다', '보지를 않' 같은 일상 어미와 구분하기 위해 비속어로 쓰일 때의
  // 후속 조사/어미가 있을 때만, 그리고 어절 시작(또는 니/네/내 뒤)일 때만 잡는다.
  jamo(
    '보지',
    '(?:ㅂㅗ|ㅈㅏ)ㅈㅣ(?:ㄹㅡ<ㄹ>(?!ㅇㅏ<ㄶ>|ㅁㅗ<ㅅ>)|ㄱㅏ(?!ㅇㅏ<ㄶ>|ㅁㅗ<ㅅ>)|ㅇ[ㅔㅑ]|ㅌㅓ<ㄹ>|ㅃㅏ<ㄹ>|ㄴ[ㅕㅗ]<[ㄴㅁ]>|<ㅅ>)',
    { tokenStart: true, prefix: /[니네내]$/ },
  ),
  jamo('니보지', 'ㄴ[ㅣㅔㅐ](?:ㅂㅗ|ㅈㅏ)ㅈㅣ', { contiguous: true }),
];

// 초성 축약. 단일 초성은 오탐이 커서 2자 이상만. compact 뷰(음절 미분해)에서만 매칭.
const CHOSUNG: Rule[] = [
  compact('초성', 'ㅅㅂ|ㅆㅂ|ㅄ|ㅂㅅ|ㅈㄴ|ㅈㄹ|ㅁㅊ|ㄱㅅㄲ|ㅅㄲ|ㅆㄲ|ㄲㅈ|ㄷㅊ|ㄴㄱㅁ'),
];

const DIGIT_TRICKS: Rule[] = [
  digits('씨8', '[씨시ㅆㅅ]8'),
  digits('18놈', '18(?:놈|년|넘|새|색|세끼|쉐)'),
];

const LATIN: Rule[] = [
  latin('영어 욕설', ['fuck', 'fck', 'fvck', 'phuck', 'shit', 'bitch', 'biatch', 'asshole', 'motherfucker']),
  latin('로마자 욕설', [
    'sibal', 'ssibal', 'shibal', 'sibar', 'shibar', 'ssibar', 'siball',
    'byungsin', 'byeongsin', 'byungshin', 'byeongshin', 'byoungsin',
    'gaesaekki', 'gaesekki', 'gaeseki', 'gaesaeki', 'gaesaeggi',
    'jiral', 'jirar', 'zirar', 'zonna',
  ]),
  // 한글 자판을 영문 상태로 친 것: tlqkf(시발) qudtls(병신) wlfkf(지랄) whssk(존나) rotorl(개새끼) tlqkfsus(시발년)
  latin('한영키 오타', ['tlqkf', 'tlqjf', 'tlqkff', 'qudtls', 'wlfkf', 'whssk', 'rotorl']),
  word('영어 욕설', ['fuk', 'cunt', 'dick', 'cock', 'ass', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'bastard', 'wtf', 'stfu']),
  word('로마자 욕설', ['sival', 'ssival', 'jonna', 'sekki', 'saekki', 'ssekki', 'seki', 'byungshin']),
];

export const RULES: Rule[] = [...SIBAL, ...INSULTS, ...CHOSUNG, ...DIGIT_TRICKS, ...LATIN];

// 오탐 방지 allowlist. 원문(대소문자 무시)에서 매치되는 구간과 겹치는 탐지는 버린다.
export const ALLOWLIST: RegExp[] = [
  /시발(?:점|역|지|차)/g, // 始發
  /\d\s*개년/g, // 5개년 계획
  /새끼\s*(?:손|발)가락/g,
  /(?:고양이|강아지|동물|돼지|토끼|햄스터|오리|닭|염소|길고양이|새)\s+새끼/g,
  /새끼\s*(?:고양이|강아지|오리|돼지|양|동물)/g,
  /등신대/g,
  /(?:전|감)염병/g,
];
