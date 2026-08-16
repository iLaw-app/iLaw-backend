// CI gate for immutable and potentially destructive Prisma migrations.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const ACK_PATTERN = /^\s*--\s*allow-destructive\s*:\s*\S+/im;
const MIGRATION_PATH = /^prisma\/migrations\/([^/]+)\/migration\.sql$/;

const DESTRUCTIVE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '테이블 삭제', pattern: /\bDROP\s+TABLE\b/i },
  { label: '컬럼 삭제', pattern: /\bDROP\s+COLUMN\b/i },
  { label: '인덱스 삭제', pattern: /\bDROP\s+INDEX\b/i },
  { label: '컬럼 타입 변경', pattern: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i },
  { label: 'NOT NULL 추가', pattern: /\bSET\s+NOT\s+NULL\b/i },
  { label: '스키마 삭제', pattern: /\bDROP\s+SCHEMA\b/i },
  { label: '데이터 삭제', pattern: /\b(TRUNCATE|DELETE\s+FROM)\b/i },
  { label: '테이블 이름 변경', pattern: /\bALTER\s+TABLE\b[\s\S]{0,120}?\bRENAME\s+TO\b/i },
  { label: '컬럼 이름 변경', pattern: /\bRENAME\s+COLUMN\b/i },
  { label: '제약조건 추가', pattern: /\bADD\s+(?:CONSTRAINT\b[\s\S]{0,120}?)?(?:UNIQUE|FOREIGN\s+KEY|PRIMARY\s+KEY|CHECK)\b/i },
];

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export function findDestructiveOperations(raw: string): string[] {
  const sql = stripComments(raw);
  return DESTRUCTIVE_RULES.filter((rule) => rule.pattern.test(sql)).map((rule) => rule.label);
}

export function classifyMigrationChanges(
  lines: string[],
  existingOnBase: ReadonlySet<string> = new Set(),
): { added: string[]; forbidden: string[] } {
  const added = new Set<string>();
  const forbidden: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const [status, ...paths] = line.split('\t');
    if (status === 'A') {
      const match = paths[0]?.match(MIGRATION_PATH);
      if (match && existingOnBase.has(match[1])) {
        forbidden.push(`${status} ${paths[0]} (already exists on base)`);
      } else if (match) {
        added.add(match[1]);
      }
      continue;
    }
    if (/^[MDRC]/.test(status) && paths.some((candidate) => MIGRATION_PATH.test(candidate))) {
      forbidden.push(`${status} ${paths.join(' -> ')}`);
    }
  }
  return { added: [...added].sort(), forbidden };
}

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

function changesSince(base: string): { added: string[]; forbidden: string[] } | null {
  try {
    const baseTree = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', 'prisma/migrations'], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const existingOnBase = new Set(
      baseTree.split('\n').flatMap((file) => {
        const match = file.trim().match(MIGRATION_PATH);
        return match ? [match[1]] : [];
      }),
    );
    const output = execFileSync('git', ['diff', '--name-status', '--find-renames', `${base}...HEAD`, '--', 'prisma/migrations'], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return classifyMigrationChanges(output.split('\n'), existingOnBase);
  } catch {
    return null;
  }
}

export function main(): void {
  const scanAll = process.argv.includes('--all');
  const base = readOption('base') ?? 'origin/main';
  let targets: string[];

  if (scanAll) {
    targets = allMigrationNames();
    console.log(`[audit] 전체 마이그레이션 ${targets.length}건을 검사합니다.`);
  } else {
    const changes = changesSince(base);
    if (!changes) {
      console.error(`[audit] '${base}' 기준 diff를 계산할 수 없습니다. base 참조를 fetch했는지 확인하거나 --all을 사용하세요.`);
      process.exitCode = 1;
      return;
    }
    if (changes.forbidden.length > 0) {
      console.error('[audit] 이미 커밋된 migration.sql은 수정, 삭제 또는 이름 변경할 수 없습니다:');
      changes.forbidden.forEach((entry) => console.error(`  - ${entry}`));
      process.exitCode = 1;
      return;
    }
    targets = changes.added;
    console.log(`[audit] ${base} 대비 신규 마이그레이션 ${targets.length}건을 검사합니다.`);
  }

  const blocked: string[] = [];
  for (const name of targets) {
    const sqlPath = path.join(MIGRATIONS_DIR, name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const raw = fs.readFileSync(sqlPath, 'utf-8');
    const hits = findDestructiveOperations(raw);
    if (hits.length > 0 && !ACK_PATTERN.test(raw)) blocked.push(`${name} — ${hits.join(', ')}`);
    else if (hits.length > 0) console.log(`[audit] 승인됨: ${name} — ${hits.join(', ')}`);
  }

  if (blocked.length === 0) {
    console.log('[audit] 미승인 파괴적 마이그레이션 없음.');
    return;
  }
  console.error('\n[audit] 파괴적 마이그레이션이 승인 주석 없이 포함되어 있습니다:');
  blocked.forEach((entry) => console.error(`  - ${entry}`));
  console.error('\n  -- allow-destructive: <백업 및 복구 계획을 포함한 사유>');
  process.exitCode = 1;
}

if (require.main === module) main();
