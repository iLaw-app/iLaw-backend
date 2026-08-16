import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('moderation service 환경변수 처리', () => {
  it('OPENAI_API_KEY가 없어도 모듈을 불러올 수 있다', () => {
    const env = { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_ADMIN_KEY;

    const result = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', '-e', "require('./src/services/moderation.service')"],
      { cwd: process.cwd(), env, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
