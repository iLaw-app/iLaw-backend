import { describe, expect, it } from 'vitest';
import { resolveScriptMode } from '../prisma/script-safety';

describe('운영 데이터 스크립트 안전 게이트', () => {
  it('기본 실행은 DB 연결 없는 dry-run이다', () => {
    expect(resolveScriptMode([], {})).toEqual({
      apply: false,
      target: 'local',
      databaseLabel: '(not connected)',
    });
  });

  it('--apply에는 DATABASE_URL이 필요하다', () => {
    expect(() => resolveScriptMode(['--apply'], {})).toThrow('DATABASE_URL is required');
  });

  it('운영으로 보이는 DB를 local 대상으로 실행하지 못한다', () => {
    expect(() => resolveScriptMode(
      ['--apply'],
      { DATABASE_URL: 'postgresql://user:pass@postgres.railway.internal:5432/railway' },
    )).toThrow('looks like production');
  });

  it('알 수 없는 원격 DB도 안전하게 production으로 취급한다', () => {
    expect(() => resolveScriptMode(
      ['--apply'],
      { DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/ilaw' },
    )).toThrow('looks like production');
  });

  it('운영 DB는 target과 확인문구가 모두 필요하다', () => {
    const env = { DATABASE_URL: 'postgresql://user:pass@postgres.railway.internal:5432/railway' };
    expect(() => resolveScriptMode(['--apply', '--target=production'], env)).toThrow(
      '--confirm-production=ilaw',
    );
  });

  it('정확히 확인된 운영 실행만 허용한다', () => {
    expect(resolveScriptMode(
      ['--apply', '--target=production', '--confirm-production=ilaw'],
      { DATABASE_URL: 'postgresql://user:pass@postgres.railway.internal:5432/railway' },
    )).toEqual({
      apply: true,
      target: 'production',
      databaseLabel: 'postgres.railway.internal/railway',
    });
  });

  it('local DB는 --apply로 실행할 수 있다', () => {
    expect(resolveScriptMode(
      ['--apply'],
      { DATABASE_URL: 'postgresql://user:pass@localhost:5432/ilaw_dev' },
    ).apply).toBe(true);
  });
});
