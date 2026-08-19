import { describe, expect, it } from 'vitest';
import { parseAgencyCsv, splitCsvLine } from '../prisma/agency-csv';

const HEADER = '지역,기관명,역할,연락처,,"<사용자가 지역 입력하면, 전국/중앙 기관 정보 + 지역별 정보 노출>"';

describe('splitCsvLine', () => {
  it('따옴표로 감싼 필드 안의 쉼표는 구분자로 보지 않는다', () => {
    expect(splitCsvLine('서울,"서울시립일시청소년쉼터(이동형,동남)",일시쉼터,02-6239-2002,,'))
      .toEqual(['서울', '서울시립일시청소년쉼터(이동형,동남)', '일시쉼터', '02-6239-2002', '', '']);
  });

  it('따옴표 안의 ""는 따옴표 한 글자로 읽는다', () => {
    expect(splitCsvLine('서울,"쉼터 ""별"" 지점",일시쉼터,02-000-0000'))
      .toEqual(['서울', '쉼터 "별" 지점', '일시쉼터', '02-000-0000']);
  });
});

describe('parseAgencyCsv', () => {
  it('헤더를 건너뛰고 지역·기관명이 채워진 행만 남긴다', () => {
    const rows = parseAgencyCsv([
      HEADER,
      '전국/중앙,경찰,긴급 아동학대·폭력 신고,112,,',
      ',,,,,',                                  // 빈 줄
      '서울,,일시쉼터,02-000-0000,,',            // 기관명 없음
      '서울,강동여자단기청소년쉼터,단기쉼터',      // 컬럼 부족
    ].join('\n'));

    expect(rows).toEqual([
      { region: '전국/중앙', name: '경찰', role: '긴급 아동학대·폭력 신고', contact: '112' },
    ]);
  });

  it('CRLF 줄바꿈과 시트에서 딸려온 BOM·제로폭 공백을 값에서 걷어낸다', () => {
    const rows = parseAgencyCsv(`${HEADER}\r\n경기,평택여자단기청소년쉼터 ${'\uFEFF'},단기쉼터,031-652-1384,,\r\n`);

    expect(rows).toEqual([
      { region: '경기', name: '평택여자단기청소년쉼터', role: '단기쉼터', contact: '031-652-1384' },
    ]);
  });
});
