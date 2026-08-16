import { beforeEach, describe, expect, it, vi } from 'vitest';

const passportMock = vi.hoisted(() => ({ use: vi.fn(), authenticate: vi.fn() }));
const kakaoStrategy = vi.hoisted(() => vi.fn(function Strategy(this: object) { return this; }));
const googleStrategy = vi.hoisted(() => vi.fn(function Strategy(this: object) { return this; }));

vi.mock('passport', () => ({ default: passportMock }));
vi.mock('passport-kakao', () => ({ Strategy: kakaoStrategy }));
vi.mock('passport-google-oauth20', () => ({ Strategy: googleStrategy }));
vi.mock('../src/prisma/client', () => ({ default: {} }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KAKAO_CLIENT_ID = 'kakao-id';
  process.env.KAKAO_CLIENT_SECRET = 'kakao-secret';
  process.env.KAKAO_CALLBACK_URL = 'https://api.test/auth/kakao/callback';
  process.env.GOOGLE_CLIENT_ID = 'google-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.GOOGLE_CALLBACK_URL = 'https://api.test/auth/google/callback';
});

describe('Passport bootstrap', () => {
  it('route import에는 설정 side effect가 없고 명시적 configure 호출로만 strategy를 등록한다', async () => {
    vi.resetModules();
    const authRoute = await import('../src/routes/auth');

    expect(passportMock.use).not.toHaveBeenCalled();

    authRoute.configureAuthPassport(passportMock as never);

    expect(passportMock.use).toHaveBeenCalledTimes(2);
  });
});
