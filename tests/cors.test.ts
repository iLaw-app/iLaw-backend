import { describe, expect, it, vi } from 'vitest';
import { buildCorsOptions, resolveAllowedOrigins } from '../src/config/cors';

const WEB = 'https://i-law-web.example.app';
const LOCAL = 'http://localhost:5173';

function originCheck(env: NodeJS.ProcessEnv, origin: string | undefined) {
  const options = buildCorsOptions(env, () => {});
  const check = options.origin;
  if (typeof check !== 'function') throw new Error('origin 검사 함수가 설정되지 않았다');
  return new Promise<boolean>((resolve, reject) => {
    check(origin, (error, allowed) => (error ? reject(error) : resolve(allowed as boolean)));
  });
}

describe('CORS 허용 origin 결정', () => {
  it('CORS_ORIGINS가 최우선이며 콤마로 여러 개를 받는다', () => {
    expect(resolveAllowedOrigins({
      CORS_ORIGINS: `${WEB}, ${LOCAL}`,
      OAUTH_WEB_REDIRECT_URI: 'https://ignored.example.app/auth',
    })).toEqual([WEB, LOCAL]);
  });

  it('CORS_ORIGINS가 없으면 OAUTH 리다이렉트 주소의 origin을 쓴다', () => {
    expect(resolveAllowedOrigins({
      OAUTH_WEB_REDIRECT_URI: `${WEB}/auth/callback`,
      OAUTH_LOCAL_REDIRECT_URI: `${LOCAL}/auth`,
    })).toEqual([WEB, LOCAL]);
  });

  it('형식이 잘못된 리다이렉트 주소는 무시한다', () => {
    expect(resolveAllowedOrigins({
      OAUTH_WEB_REDIRECT_URI: 'not-a-url',
      OAUTH_LOCAL_REDIRECT_URI: `${LOCAL}/auth`,
    })).toEqual([LOCAL]);
  });

  it('설정이 전혀 없으면 빈 목록이다', () => {
    expect(resolveAllowedOrigins({})).toEqual([]);
  });
});

describe('CORS 정책 적용', () => {
  it('허용 목록에 있는 origin을 통과시킨다', async () => {
    await expect(originCheck({ CORS_ORIGINS: WEB }, WEB)).resolves.toBe(true);
  });

  it('허용 목록에 없는 origin에는 허용 헤더를 붙이지 않는다', async () => {
    await expect(originCheck({ CORS_ORIGINS: WEB }, 'https://evil.example.com')).resolves.toBe(false);
  });

  it('origin 헤더가 없는 요청(서버 간 호출, 헬스체크)은 통과시킨다', async () => {
    await expect(originCheck({ CORS_ORIGINS: WEB }, undefined)).resolves.toBe(true);
  });

  it('설정이 없으면 종전처럼 전체 허용하되 경고를 남긴다', () => {
    const warn = vi.fn();
    expect(buildCorsOptions({}, warn)).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CORS_ORIGINS'));
  });
});
