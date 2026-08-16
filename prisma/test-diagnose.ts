import 'dotenv/config';
import prisma from '../src/prisma/client';
import { diagnose } from '../src/services/ai.service';

// 프로덕션 진단 로직을 여러 시나리오로 직접 호출(인증·쿼터·저장 없음).
// 실행: railway run -s Postgres -- bash -lc \
//   'DATABASE_URL="$DATABASE_PUBLIC_URL" AI_CRISIS_ENABLED=true AI_HYBRID_SEARCH_ENABLED=true \
//    npx ts-node prisma/test-diagnose.ts'

const CASES: { label: string; msg: string }[] = [
  { label: '학폭 피해자', msg: '친구들이 나 왕따시키는거 같아 내 체육복 쓰레기통에 막 버려' },
  { label: '학폭 가해자', msg: '제가 홧김에 친구를 한 대 때렸는데 학폭위가 열릴까요?' },
  { label: '아동학대(위기)', msg: '아빠가 술만 마시면 저랑 동생을 때려요. 무서워요' },
  { label: '임금체불', msg: '회사에서 3개월째 월급을 안 줘요. 어떻게 받죠?' },
  { label: '디지털성범죄(위기)', msg: '헤어진 남친이 제 사진을 단톡방에 뿌리겠다고 협박해요' },
  { label: '성폭력 피해', msg: '직장 상사가 자꾸 몸을 만지고 밤에 연락해요' },
  { label: '출생/양육', msg: '아이 출생신고는 어디서 어떻게 하나요?' },
  { label: '무관(잡담)', msg: '오늘 점심 뭐 먹지?' },
];

async function main() {
  for (const c of CASES) {
    console.log('\n' + '='.repeat(72));
    console.log(`[${c.label}] "${c.msg}"`);
    console.log('-'.repeat(72));
    try {
      const r = await diagnose(c.msg, '테스트', [], { region: '서울' });
      console.log('status     :', r.status);
      console.log('summary    :', r.situationSummary || '(없음)');
      console.log('advice     :', r.legalAdvice);
      console.log('suggestions:');
      for (const s of r.suggestions) {
        if (s.type === 'manual') console.log(`   - [매뉴얼] ${s.label}`);
        else if (s.type === 'agency') console.log(`   - [기관/${(s as any).region ?? '?'}] ${s.label} (${(s as any).contact})`);
        else if (s.type === 'hotline') console.log(`   - [핫라인] ${s.label} (${(s as any).phone})`);
        else console.log('   -', JSON.stringify(s));
      }
    } catch (e) {
      console.log('ERROR:', (e as Error).message);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
