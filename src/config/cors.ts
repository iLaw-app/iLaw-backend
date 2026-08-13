import type { CorsOptions } from 'cors';

// 허용 origin 결정 순서:
//  1. CORS_ORIGINS (콤마 구분) — 명시 설정이 항상 우선한다.
//  2. 미설정 시 OAUTH_*_REDIRECT_URI의 origin을 사용한다. 이 값들은 로그인 후
//     클라이언트로 돌려보내는 주소이므로 곧 프론트엔드의 origin이다. 덕분에
//     운영/로컬 모두 별도 설정 없이도 자기 프론트엔드만 허용하게 된다.
//  3. 둘 다 없으면 모든 origin을 허용한다(종전 동작). 설정 누락으로 서비스가
//     죽는 것보다 낫지만 의도한 상태는 아니므로 경고를 남긴다.
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (explicit && explicit.length > 0) return explicit;

  const derived = new Set<string>();
  for (const uri of [env.OAUTH_WEB_REDIRECT_URI, env.OAUTH_LOCAL_REDIRECT_URI]) {
    if (!uri?.trim()) continue;
    try {
      derived.add(new URL(uri.trim()).origin);
    } catch {
      // 형식이 잘못된 값은 무시한다. 이 함수는 CORS 정책만 책임진다.
    }
  }
  return [...derived];
}

export function buildCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): CorsOptions {
  const allowedOrigins = resolveAllowedOrigins(env);

  if (allowedOrigins.length === 0) {
    warn('[cors] CORS_ORIGINS와 OAUTH_*_REDIRECT_URI가 모두 없어 모든 origin을 허용합니다. 운영에서는 CORS_ORIGINS를 설정하세요.');
    return {};
  }

  return {
    // origin 헤더가 없는 요청(서버 간 호출, curl, 헬스체크)은 CORS 대상이 아니므로 통과시킨다.
    // 허용되지 않은 origin은 예외를 던지는 대신 Access-Control-Allow-Origin 헤더를
    // 생략한다 — 차단은 브라우저가 하고, 서버는 500과 에러 로그를 남기지 않는다.
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  };
}
