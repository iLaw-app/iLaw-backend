// 파괴적 마이그레이션 감지 게이트.
//
// railway.toml의 startCommand가 `prisma migrate deploy`이므로 머지된 마이그레이션은
// 다음 배포에서 자동으로 운영 DB에 적용된다. 즉 리뷰를 통과하는 순간이 사실상
// 운영 반영 시점이다. 이 스크립트는 되돌릴 수 없는 SQL을 PR 단계에서 드러내,
// 작성자가 의식적으로 승인 주석을 남기도록 강제한다.
//
// 사용: npm run migrate:audit              (origin/main 대비 신규 마이그레이션)
//       npm run migrate:audit -- --all     (전체 마이그레이션)
//       npm run migrate:audit -- --base=<git-ref>
//
// 승인 방법: 해당 migration.sql 안에 사유와 함께 아래 주석을 남긴다.
//   -- allow-destructive: <되돌릴 수 없는 이유와 백업/복구 계획>

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const ACK_PATTERN = /^\s*--\s*allow-destructive\s*:\s*\S+/im;

const DESTRUCTIVE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '테이블 삭제', pattern: /\bDROP\s+TABLE\b/i },
  { label: '컬럼 삭제', pattern: /\bDROP\s+COLUMN\b/i },
  { label: '컬럼 타입 변경', pattern: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i },
  { label: 'NOT NULL 추가', pattern: /\bSET\s+NOT\s+NULL\b/i },
  { label: '스키마 삭제', pattern: /\bDROP\s+SCHEMA\b/i },
  { label: '데이터 삭제', pattern: /\b(TRUNCATE|DELETE\s+FROM)\b/i },
];

function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function allMigrationNames(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => fs.existsSync(path.join(MIGRATIONS_DIR, name, 'migration.sql')))
    .sort();
}

// base 이후 "추가된" 마이그레이션만 고른다. 이미 머지되어 운영에 적용된 것을
// 매번 다시 실패시키면 게이트가 무력해지기 때문이다.
function addedSince(base: string): string[] | null {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', 'prisma/migrations'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const names = new Set<string>();
    for (const file of output.split('\n')) {
      const match = file.trim().match(/^prisma\/migrations\/([^/]+)\/migration\.sql$/);
      if (match) names.add(match[1]);
    }
    return [...names].sort();
  } catch {
    return null;
  }
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function main() {
  const scanAll = process.argv.includes('--all');
  const base = readOption('base') ?? 'origin/main';

  let targets: string[];
  if (scanAll) {
    targets = allMigrationNames();
    console.log(`[audit] 전체 마이그레이션 ${targets.length}건을 검사합니다.`);
  } else {
    const added = addedSince(base);
    if (added === null) {
      console.error(`[audit] '${base}' 기준 diff를 계산할 수 없습니다. base 참조를 fetch했는지 확인하거나 --all을 사용하세요.`);
      process.exit(1);
    }
    targets = added;
    console.log(`[audit] ${base} 대비 신규 마이그레이션 ${targets.length}건을 검사합니다.`);
  }

  const blocked: string[] = [];
  const acknowledged: string[] = [];

  for (const name of targets) {
    const sqlPath = path.join(MIGRATIONS_DIR, name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const raw = fs.readFileSync(sqlPath, 'utf-8');
    const sql = stripComments(raw);

    const hits = DESTRUCTIVE_RULES.filter((rule) => rule.pattern.test(sql)).map((rule) => rule.label);
    if (hits.length === 0) continue;

    if (ACK_PATTERN.test(raw)) {
      acknowledged.push(`${name} — ${hits.join(', ')}`);
    } else {
      blocked.push(`${name} — ${hits.join(', ')}`);
    }
  }

  for (const entry of acknowledged) console.log(`[audit] 승인됨: ${entry}`);

  if (blocked.length === 0) {
    console.log('[audit] 미승인 파괴적 마이그레이션 없음.');
    return;
  }

  console.error('\n[audit] 되돌릴 수 없는 마이그레이션이 승인 주석 없이 포함되어 있습니다:\n');
  for (const entry of blocked) console.error(`  - ${entry}`);
  console.error(`
이 마이그레이션은 머지 후 다음 배포에서 운영 DB에 자동 적용됩니다.
진행하려면 운영 DB 백업을 확인한 뒤 해당 migration.sql에 사유를 남기세요:

  -- allow-destructive: <되돌릴 수 없는 이유와 백업/복구 계획>
`);
  process.exit(1);
}

main();
