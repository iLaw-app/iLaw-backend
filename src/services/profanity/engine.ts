// 금칙어 탐지 엔진 (1차 필터, 동기 하드블록).
// 원문을 여러 정규화 뷰로 변환하되 각 뷰의 문자가 원문의 어느 구간에서 왔는지 인덱스 맵을 유지한다.
// 그래서 결과는 항상 "원문 기준 오프셋"으로 돌아가고, 프론트가 입력창에서 그 구간을 그대로 표시할 수 있다.
// 문맥·우회 표현의 최종 방어선은 2차 OpenAI Moderation(moderation.service)이다.

import { conjoiningToCompat, decomposeSyllable, isCompatJamo, isHangulSyllable } from './hangul';
import { ALLOWLIST, RULES, type Rule, type ViewName } from './rules';

export interface ProfanityMatch {
  /** 원문에서 잘라낸 표현 (text.slice(start, end)) */
  word: string;
  start: number;
  end: number;
}

type UnitKind = 'hangul' | 'jamo' | 'latin' | 'digit' | 'space' | 'other';

interface Unit {
  ch: string;
  kind: UnitKind;
  start: number; // 원문 오프셋
  end: number;
}

interface View {
  text: string;
  starts: number[]; // view.text[i] 가 유래한 원문 시작 오프셋
  ends: number[];
}

const LEET: Record<string, string> = { '1': 'i', '3': 'e', '4': 'a', '0': 'o', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
const LOOKALIKE_I = new Set(['l', 'i', '|']);
// 공백을 가로지르는 매치에서 마지막 어절의 나머지가 이 글자로 시작하면 욕설의 접미(놈/년/아/이…)로 본다.
const TRAILING_SUFFIX = /^[놈년넘새색롬럼것같이아야들임짓질하네지게냐노니]/u;
const CONTENT_CHAR = /[\p{L}\p{N}]/u;

function classify(ch: string): UnitKind {
  const cp = ch.codePointAt(0)!;
  if (isHangulSyllable(cp)) return 'hangul';
  if (isCompatJamo(cp)) return 'jamo';
  if (cp >= 0x61 && cp <= 0x7a) return 'latin';
  if (cp >= 0x30 && cp <= 0x39) return 'digit';
  if (/\s/u.test(ch)) return 'space';
  return 'other';
}

// 원문 → 정규화된 단위 배열. 코드포인트마다 NFKC + 소문자 처리(전각 영문 등)하고,
// 조합용 자모는 호환 자모로 되돌린다. 확장된 문자들은 모두 원래 코드포인트의 오프셋을 가리킨다.
function tokenize(text: string): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const start = i;
    const end = i + len;
    i = end;
    if (isCompatJamo(cp) || isHangulSyllable(cp)) {
      units.push({ ch: String.fromCodePoint(cp), kind: isCompatJamo(cp) ? 'jamo' : 'hangul', start, end });
      continue;
    }
    const normalized = String.fromCodePoint(cp).normalize('NFKC').toLowerCase();
    for (const raw of normalized) {
      const compat = conjoiningToCompat(raw.codePointAt(0)!);
      const ch = compat ?? raw;
      units.push({ ch, kind: classify(ch), start, end });
    }
  }
  return units;
}

function isHangulish(u: Unit | undefined): boolean {
  return u !== undefined && (u.kind === 'hangul' || u.kind === 'jamo');
}

// 같은 문자가 연속되면 하나로 축약 ('개새끼끼끼' → '개새끼', 'fuuuck' → 'fuck').
function collapse(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  for (const u of units) {
    const last = out[out.length - 1];
    if (last && last.ch === u.ch && last.kind !== 'space') continue;
    out.push(u);
  }
  return out;
}

function toView(units: Unit[], expand: (u: Unit) => string[]): View {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (const u of units) {
    for (const ch of expand(u)) {
      text += ch;
      starts.push(u.start);
      ends.push(u.end);
    }
  }
  return { text, starts, ends };
}

function buildJamoView(units: Unit[]): View {
  const kept: Unit[] = [];
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u.kind === 'hangul' || u.kind === 'jamo') {
      kept.push(u);
      continue;
    }
    // 낱자모 자음 뒤에 낀 l / i / | 는 'ㅣ'로 본다 (ㅅl발 → ㅅㅣ발). 그 외 라틴/숫자/기호는 버린다 (시1발 → 시발).
    if (LOOKALIKE_I.has(u.ch) && kept[kept.length - 1]?.kind === 'jamo') {
      let j = i + 1;
      while (j < units.length && (units[j].kind === 'space' || units[j].kind === 'other')) j += 1;
      if (isHangulish(units[j])) kept.push({ ...u, ch: 'ㅣ', kind: 'jamo' });
    }
  }
  const view = toView(collapse(kept), (u) => (u.kind === 'hangul' ? decomposeSyllable(u.ch.codePointAt(0)!) : [u.ch]));
  return collapseView(view); // 'ㅅㅣ' + 'ㅣ' 처럼 분해 후 생긴 중복 자모도 축약
}

function collapseView(view: View): View {
  const out: View = { text: '', starts: [], ends: [] };
  for (let i = 0; i < view.text.length; i += 1) {
    if (i > 0 && view.text[i] === view.text[i - 1]) continue;
    out.text += view.text[i];
    out.starts.push(view.starts[i]);
    out.ends.push(view.ends[i]);
  }
  return out;
}

function buildCompactView(units: Unit[], keepDigits: boolean): View {
  const kept = units.filter((u) => u.kind === 'hangul' || u.kind === 'jamo' || (keepDigits && u.kind === 'digit'));
  return toView(collapse(kept), (u) => [u.ch]);
}

function leet(u: Unit): string | null {
  if (u.kind === 'latin') return u.ch;
  const mapped = LEET[u.ch];
  return mapped ?? null;
}

function buildLatinView(units: Unit[]): View {
  const kept: Unit[] = [];
  for (const u of units) {
    const ch = leet(u);
    if (ch !== null) kept.push({ ...u, ch, kind: 'latin' });
  }
  return toView(collapse(kept), (u) => [u.ch]);
}

// 라틴/숫자 외의 모든 문자는 단어 경계(공백 하나)로 바뀐다. 반복 축약은 하지 않는다.
function buildWordView(units: Unit[]): View {
  const kept: Unit[] = [];
  for (const u of units) {
    const ch = leet(u);
    if (ch !== null) {
      kept.push({ ...u, ch, kind: 'latin' });
      continue;
    }
    const last = kept[kept.length - 1];
    if (!last || last.ch !== ' ') kept.push({ ...u, ch: ' ', kind: 'space' });
  }
  return toView(kept, (u) => [u.ch]);
}

function buildViews(text: string): Record<ViewName, View> {
  const units = tokenize(text);
  return {
    jamo: buildJamoView(units),
    compact: buildCompactView(units, false),
    digits: buildCompactView(units, true),
    latin: buildLatinView(units),
    word: buildWordView(units),
  };
}

function allowSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of ALLOWLIST) {
    const flags = re.flags.includes('i') ? re.flags : `${re.flags}i`;
    const global = new RegExp(re.source, flags.includes('g') ? flags : `${flags}g`);
    for (const m of text.matchAll(global)) spans.push([m.index!, m.index! + m[0].length]);
  }
  return spans;
}

function isContent(ch: string): boolean {
  return CONTENT_CHAR.test(ch);
}

// 공백을 가로지르는 매치: 마지막 조각을 제외한 모든 조각은 온전한 어절이어야 하고,
// 마지막 조각은 어절의 앞부분이어야 한다. ('시 발' O, '시 발놈' O, '당시 발생' X, 'wash it' X)
function validateCrossingSpaces(text: string, start: number, end: number): boolean {
  const slice = text.slice(start, end);
  if (!/\s/u.test(slice)) return true;

  // 매치와 겹치는 어절 목록 [tokenStart, tokenEnd)
  const tokens: Array<[number, number]> = [];
  let i = start;
  while (i > 0 && !/\s/u.test(text[i - 1])) i -= 1;
  while (i < end) {
    while (i < end && /\s/u.test(text[i])) i += 1;
    if (i >= end) break;
    const tokenStart = i;
    while (i < text.length && !/\s/u.test(text[i])) i += 1;
    tokens.push([tokenStart, i]);
  }

  for (let t = 0; t < tokens.length; t += 1) {
    const [ts, te] = tokens[t];
    const isLast = t === tokens.length - 1;
    for (let k = ts; k < te; k += 1) {
      const outside = k < start || (!isLast && k >= end);
      if (outside && isContent(text[k])) return false;
    }
    if (isLast && end < te) {
      // 마지막 어절의 남은 부분은 욕설 접미여야 한다. ('시 발놈' O, '시 발표' X)
      const rest = text.slice(end, te).replace(/^[^\p{L}\p{N}]+/u, '');
      if (rest.length > 0 && !TRAILING_SUFFIX.test(rest)) return false;
    }
  }
  return true;
}

function precedingContext(text: string, start: number): string {
  let i = start;
  while (i > 0 && !isContent(text[i - 1]) && !/\s/u.test(text[i - 1])) i -= 1;
  return text.slice(0, i);
}

function followingContext(text: string, end: number): string {
  let i = end;
  while (i < text.length && !isContent(text[i]) && !/\s/u.test(text[i])) i += 1;
  return text.slice(i);
}

function accept(text: string, rule: Rule, start: number, end: number, allowed: Array<[number, number]>): boolean {
  if (allowed.some(([as, ae]) => as < end && start < ae)) return false;
  const slice = text.slice(start, end);
  if (rule.contiguous && /\s/u.test(slice)) return false;
  if (!validateCrossingSpaces(text, start, end)) return false;
  if (rule.tokenStart) {
    const before = precedingContext(text, start);
    const atStart = before.length === 0 || /\s$/u.test(before) || (rule.prefix?.test(before) ?? false);
    if (!atStart) return false;
  }
  if (rule.tokenEnd) {
    const after = followingContext(text, end);
    if (!(after.length === 0 || /^\s/u.test(after))) return false;
  }
  if (rule.notPreceded && rule.notPreceded.test(text.slice(0, start))) return false;
  return true;
}

function mergeSpans(text: string, spans: Array<[number, number]>): ProfanityMatch[] {
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.map(([start, end]) => ({ word: text.slice(start, end), start, end }));
}

// 원문에서 금칙어로 판정된 구간 목록(원문 오프셋, 병합·정렬됨). 없으면 빈 배열.
export function findProfanity(text: string | null | undefined): ProfanityMatch[] {
  if (!text) return [];
  const views = buildViews(text);
  const allowed = allowSpans(text);
  const spans: Array<[number, number]> = [];

  for (const rule of RULES) {
    const view = views[rule.view];
    if (view.text.length === 0) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(view.text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
        continue;
      }
      const from = m.index;
      const to = m.index + m[0].length - 1;
      const start = view.starts[from];
      const end = view.ends[to];
      // 다음 탐색은 한 글자 뒤부터 — 겹치는 표현(시발시발)도 모두 잡는다.
      rule.re.lastIndex = from + 1;
      if (accept(text, rule, start, end, allowed)) spans.push([start, end]);
    }
  }
  return mergeSpans(text, spans);
}

export function containsProfanity(text: string | null | undefined): boolean {
  return findProfanity(text).length > 0;
}

export type ProfanityFieldReport<K extends string = string> = Partial<Record<K, ProfanityMatch[]>>;

// 여러 필드를 한 번에 검사. 걸린 필드만 담아 돌려주고, 하나도 없으면 null.
export function checkProfanityFields<K extends string>(
  fields: Record<K, string | null | undefined>,
): ProfanityFieldReport<K> | null {
  const report: ProfanityFieldReport<K> = {};
  let blocked = false;
  for (const key of Object.keys(fields) as K[]) {
    const matches = findProfanity(fields[key]);
    if (matches.length > 0) {
      report[key] = matches;
      blocked = true;
    }
  }
  return blocked ? report : null;
}
