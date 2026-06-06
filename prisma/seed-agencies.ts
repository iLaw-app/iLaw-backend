/**
 * 특정 카테고리의 Agency 데이터만 upsert하는 스크립트
 * 사용: npx ts-node prisma/seed-agencies.ts <slug>
 * 예시: npx ts-node prisma/seed-agencies.ts school-violence
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const AGENCIES_DIR = path.join(__dirname, 'data', 'agencies');

const CATEGORY_CONFIG: Record<string, { name: string; slug: string; order: number; agencyCsv: string }> = {
  'finance':             { name: '금융(빚 사기 도박)',          slug: 'finance',             order: 1, agencyCsv: '금융.csv' },
  'labor':               { name: '노동',                        slug: 'labor',               order: 2, agencyCsv: '노동.csv' },
  'sexual-violence':     { name: '성폭력 데이트폭력 성착취',    slug: 'sexual-violence',     order: 3, agencyCsv: '성폭력.csv' },
  'child-abuse':         { name: '아동학대',                    slug: 'child-abuse',         order: 4, agencyCsv: '아동학대.csv' },
  'online-violence':     { name: '온라인폭력',                  slug: 'online-violence',     order: 5, agencyCsv: '온라인폭력.csv' },
  'birth-and-parenting': { name: '출생과 양육',                 slug: 'birth-and-parenting', order: 6, agencyCsv: '출생과양육.csv' },
  'parental-rights':     { name: '친권 미성년후견',             slug: 'parental-rights',     order: 7, agencyCsv: '친권미성년후견.csv' },
  'school-violence':     { name: '학교폭력',                   slug: 'school-violence',     order: 8, agencyCsv: '학교폭력.csv' },
};

function parseCsv(filePath: string): Array<{ region: string; name: string; role: string; contact: string }> {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n').slice(1); // skip header

  return lines
    .map(line => line.split(','))
    .filter(cols => cols.length >= 4 && cols[0].trim() && cols[1].trim())
    .map(cols => ({
      region:  cols[0].trim(),
      name:    cols[1].trim(),
      role:    cols[2].trim(),
      contact: cols[3].trim(),
    }));
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('슬러그를 인수로 넣어주세요. 예: npx ts-node prisma/seed-agencies.ts school-violence');
    console.error('사용 가능한 슬러그:', Object.keys(CATEGORY_CONFIG).join(', '));
    process.exit(1);
  }

  const config = CATEGORY_CONFIG[slug];
  if (!config) {
    console.error(`알 수 없는 슬러그: ${slug}`);
    console.error('사용 가능한 슬러그:', Object.keys(CATEGORY_CONFIG).join(', '));
    process.exit(1);
  }

  const csvPath = path.join(AGENCIES_DIR, config.agencyCsv);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
    process.exit(1);
  }

  // 카테고리 upsert
  const category = await prisma.manualCategory.upsert({
    where: { slug: config.slug },
    update: { name: config.name, order: config.order },
    create: { name: config.name, slug: config.slug, order: config.order },
  });
  console.log(`카테고리: ${config.name} (id=${category.id})`);

  // 기존 agencies 삭제 후 재삽입
  const deleted = await prisma.agency.deleteMany({ where: { categoryId: category.id } });
  console.log(`  기존 기관 ${deleted.count}개 삭제`);

  const agencies = parseCsv(csvPath).map(a => ({ ...a, categoryId: category.id }));
  await prisma.agency.createMany({ data: agencies });
  console.log(`  기관 ${agencies.length}개 삽입 완료`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
