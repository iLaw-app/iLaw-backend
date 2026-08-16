import { describe, expect, it } from 'vitest';
import { classifyMigrationChanges, findDestructiveOperations } from '../prisma/audit-migrations';

describe('migration audit', () => {
  it('classifies added, modified, and renamed migration SQL paths', () => {
    const changes = classifyMigrationChanges([
      'A\tprisma/migrations/20260101_add/migration.sql',
      'M\tprisma/migrations/20250101_applied/migration.sql',
      'R100\tprisma/migrations/20240101_old/migration.sql\tprisma/migrations/20240101_new/migration.sql',
    ]);
    expect(changes.added).toEqual(['20260101_add']);
    expect(changes.forbidden).toEqual(expect.arrayContaining(['M prisma/migrations/20250101_applied/migration.sql', expect.stringContaining('R100')]));
  });

  it('rejects a branch-added migration name that already exists on the current base branch', () => {
    const changes = classifyMigrationChanges(
      ['A\tprisma/migrations/20260101_add/migration.sql'],
      new Set(['20260101_add']),
    );
    expect(changes.added).toEqual([]);
    expect(changes.forbidden).toEqual([
      'A prisma/migrations/20260101_add/migration.sql (already exists on base)',
    ]);
  });

  it('detects dangerous constraint and rename DDL in addition to drops', () => {
    const hits = findDestructiveOperations(`
      ALTER TABLE "User" RENAME COLUMN "name" TO "displayName";
      ALTER TABLE "User" ADD CONSTRAINT "email_unique" UNIQUE ("email");
      DROP INDEX "old_idx";
    `);
    expect(hits).toEqual(expect.arrayContaining(['컬럼 이름 변경', '제약조건 추가', '인덱스 삭제']));
  });
});
