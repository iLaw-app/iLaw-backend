import * as fs from 'fs';

export type AgencyRow = { region: string; name: string; role: string; contact: string };

// 시트 export에는 BOM(U+FEFF)·제로폭 공백(U+200B)이 값에 섞여 들어온다.
// 그대로 두면 같은 기관이 다른 이름으로 저장되므로 값 단위로 제거한다.
function clean(value: string): string {
  return value.replace(/[\uFEFF\u200B\r]/g, '').trim();
}

// 기관명에 쉼표가 들어가는 경우가 있어("서울시립일시청소년쉼터(이동형,동남)")
// 따옴표로 감싼 필드를 인식한다. 따옴표 안의 ""는 따옴표 한 글자를 뜻한다.
export function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (line[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { cols.push(field); field = ''; continue; }
    field += char;
  }

  cols.push(field);
  return cols;
}

/** 헤더를 건너뛰고 지역·기관명이 모두 채워진 행만 남긴다. */
export function parseAgencyCsv(text: string): AgencyRow[] {
  return text
    .split('\n')
    .slice(1)
    .map(splitCsvLine)
    .filter(cols => cols.length >= 4 && clean(cols[0]) && clean(cols[1]))
    .map(cols => ({
      region:  clean(cols[0]),
      name:    clean(cols[1]),
      role:    clean(cols[2]),
      contact: clean(cols[3]),
    }));
}

export function readAgencyCsv(filePath: string): AgencyRow[] {
  return parseAgencyCsv(fs.readFileSync(filePath, 'utf-8'));
}
