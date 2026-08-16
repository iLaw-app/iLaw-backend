import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProfanityFields, containsProfanity, findProfanity } from '../src/services/profanity';

type Corpus = { toxic: Record<string, string[]>; clean: Record<string, string[]> };
const { toxic, clean } = JSON.parse(readFileSync(join(__dirname, 'fixtures/profanity-corpus.json'), 'utf8')) as Corpus;

function flatten(groups: Record<string, string[]>): Array<{ group: string; text: string }> {
  return Object.entries(groups).flatMap(([group, texts]) => texts.map((text) => ({ group, text })));
}

describe('금칙어 코퍼스 — 재현율/정밀도', () => {
  const toxicItems = flatten(toxic);
  const cleanItems = flatten(clean);

  it('toxic 코퍼스는 전부 잡는다 (재현율 100%)', () => {
    const missed = toxicItems.filter(({ text }) => !containsProfanity(text));
    expect(missed.map((m) => `${m.group}: ${m.text}`)).toEqual([]);
  });

  it('clean 코퍼스는 하나도 잡지 않는다 (오탐 0)', () => {
    const falsePositives = cleanItems
      .map((item) => ({ ...item, matches: findProfanity(item.text) }))
      .filter((item) => item.matches.length > 0);
    expect(
      falsePositives.map((f) => `${f.group}: ${f.text} → ${f.matches.map((m) => m.word).join(',')}`),
    ).toEqual([]);
  });

  it('코퍼스 크기가 회귀 기준으로 충분하다', () => {
    expect(toxicItems.length).toBeGreaterThanOrEqual(200);
    expect(cleanItems.length).toBeGreaterThanOrEqual(150);
  });
});

describe('적대적 변형 자동 생성 — 기본어 × 우회 기법', () => {
  const bases = ['시발', '씨발', '병신', '지랄', '존나', '개새끼', '새끼', '미친놈', '니미럴', '씨팔', '쌍놈', '엠창'];
  const separators = [' ', '.', '-', '_', '~', '!', '*', '  ', ' . '];

  function variants(word: string): string[] {
    const syllables = Array.from(word);
    const out: string[] = [];
    for (const sep of separators) out.push(syllables.join(sep));
    out.push(`${word}${syllables[syllables.length - 1].repeat(3)}`); // 마지막 음절 반복
    out.push(`야 ${word}아`, `${word}!!!`, `(${word})`, `ㅋㅋ${word}ㅋㅋ`, `이런 ${word} 같은`);
    out.push(word.toUpperCase());
    return out;
  }

  it('구분자 삽입·반복·괄호·문장 삽입 변형을 모두 잡는다', () => {
    const missed: string[] = [];
    for (const base of bases) {
      for (const v of variants(base)) if (!containsProfanity(v)) missed.push(JSON.stringify(v));
    }
    expect(missed).toEqual([]);
  });
});

describe('매치 오프셋', () => {
  it('start/end 는 원문 기준이며 word 는 그 구간을 그대로 자른 것이다', () => {
    for (const { text } of flatten(toxic)) {
      for (const m of findProfanity(text)) {
        expect(m.start).toBeGreaterThanOrEqual(0);
        expect(m.end).toBeLessThanOrEqual(text.length);
        expect(m.end).toBeGreaterThan(m.start);
        expect(text.slice(m.start, m.end)).toBe(m.word);
      }
    }
  });

  it('구간이 겹치지 않고 정렬되어 있다', () => {
    const matches = findProfanity('시발 개새끼 시발시발 fuck 병 신');
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i].start).toBeGreaterThanOrEqual(matches[i - 1].end);
    }
    expect(matches.map((m) => m.word)).toEqual(['시발', '개새끼', '시발시발', 'fuck', '병 신']);
  });

  it('공백·기호로 우회한 표현도 원문 구간 전체를 가리킨다', () => {
    expect(findProfanity('이거 시-발 뭐야')).toEqual([{ word: '시-발', start: 3, end: 6 }]);
    expect(findProfanity('ㅅ ㅂ')).toEqual([{ word: 'ㅅ ㅂ', start: 0, end: 3 }]);
    expect(findProfanity('you f.u.c.k er')).toEqual([{ word: 'f.u.c.k', start: 4, end: 11 }]);
  });

  it('전각·이모지가 섞여도 UTF-16 오프셋이 맞는다', () => {
    const text = '😀 ｆｕｃｋ 😀 시발';
    const matches = findProfanity(text);
    expect(matches.map((m) => m.word)).toEqual(['ｆｕｃｋ', '시발']);
    for (const m of matches) expect(text.slice(m.start, m.end)).toBe(m.word);
  });
});

describe('공백 가로지르기 규칙', () => {
  it('두 어절이 모두 온전하면 잡는다', () => {
    expect(containsProfanity('시 발')).toBe(true);
    expect(containsProfanity('병 신')).toBe(true);
    expect(containsProfanity('개 새끼야')).toBe(true);
    expect(containsProfanity('시 발놈아')).toBe(true);
  });

  it('앞 어절의 일부만 걸치면 잡지 않는다 (당시 발생, 10시 발표)', () => {
    expect(containsProfanity('당시 발생한 일')).toBe(false);
    expect(containsProfanity('10시 발표')).toBe(false);
    expect(containsProfanity('역시 발이 아프네요')).toBe(false);
    expect(containsProfanity('wash it')).toBe(false);
  });

  it('뒤 어절의 나머지가 욕설 접미가 아니면 잡지 않는다 (두 시 발표)', () => {
    expect(containsProfanity('두 시 발표합니다')).toBe(false);
    expect(containsProfanity('병 신고했어요')).toBe(false);
  });
});

describe('checkProfanityFields', () => {
  it('걸린 필드만 담아 돌려주고 없으면 null', () => {
    expect(checkProfanityFields({ title: '안녕하세요', content: '좋은 글' })).toBeNull();
    expect(checkProfanityFields({ title: '시발 제목', content: '정상 본문', extra: undefined })).toEqual({
      title: [{ word: '시발', start: 0, end: 2 }],
    });
  });
});
