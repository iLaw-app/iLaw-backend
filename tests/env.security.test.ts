import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('OAuth 환경 설정 검증', () => {
  it('OAUTH_STATE_SECRET이 32 bytes보다 짧으면 시작을 중단한다', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.OAUTH_STATE_SECRET = 'weak';

    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(import('../src/config/env')).rejects.toThrow('process.exit:1');
    expect(exit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('OAUTH_STATE_SECRET'));
  });
});
