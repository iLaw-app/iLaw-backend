import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ get: vi.fn(), isAxiosError: vi.fn() }));
vi.mock('axios', () => ({ default: axiosMock }));

beforeEach(() => vi.clearAllMocks());

describe('OAuth provider adapter', () => {
  it('Kakao 사용자 조회에 명시적 timeout을 적용한다', async () => {
    axiosMock.get.mockResolvedValue({ data: { id: 123, kakao_account: { email: 'a@example.com' } } });
    const { verifyKakaoAccessToken, OAUTH_PROVIDER_TIMEOUT_MS } = await import('../src/services/oauth-provider.service');

    await expect(verifyKakaoAccessToken('provider-token')).resolves.toEqual({
      providerId: '123',
      email: 'a@example.com',
    });
    expect(axiosMock.get).toHaveBeenCalledWith(
      'https://kapi.kakao.com/v2/user/me',
      expect.objectContaining({ timeout: OAUTH_PROVIDER_TIMEOUT_MS }),
    );
  });

  it('Kakao credential 오류와 provider timeout을 구분한다', async () => {
    const { verifyKakaoAccessToken, OAuthCredentialError, OAuthProviderUnavailableError } = await import('../src/services/oauth-provider.service');
    axiosMock.isAxiosError.mockReturnValue(true);

    axiosMock.get.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(verifyKakaoAccessToken('bad')).rejects.toBeInstanceOf(OAuthCredentialError);

    axiosMock.get.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await expect(verifyKakaoAccessToken('slow')).rejects.toBeInstanceOf(OAuthProviderUnavailableError);
  });
});

describe('SDK login controller 오류 분류', () => {
  it('DB 장애를 잘못된 provider token 401로 오인하지 않고 error middleware로 전달한다', async () => {
    vi.resetModules();
    const dbError = new Error('database unavailable');
    vi.doMock('../src/services/oauth-provider.service', async () => {
      const actual = await vi.importActual<typeof import('../src/services/oauth-provider.service')>('../src/services/oauth-provider.service');
      return { ...actual, verifyKakaoAccessToken: vi.fn().mockResolvedValue({ providerId: '1' }) };
    });
    vi.doMock('../src/services/auth.service', () => ({
      upsertUser: vi.fn().mockRejectedValue(dbError),
      issueTokenPair: vi.fn(),
    }));
    const { kakaoSdkLogin } = await import('../src/controllers/social.controller');
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();

    await kakaoSdkLogin(
      { body: { accessToken: 'valid-provider-token' } } as never,
      { status, json } as never,
      next,
    );

    expect(status).not.toHaveBeenCalledWith(401);
    expect(next).toHaveBeenCalledWith(dbError);
  });
});
