import { describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({
  rotateRefreshToken: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  deleteUserAccount: vi.fn(),
  InvalidRefreshTokenError: class InvalidRefreshTokenError extends Error {},
}));
const profileMock = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  completeUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  isUniqueConstraintError: vi.fn(),
}));

vi.mock('../src/services/auth.service', () => authMock);
vi.mock('../src/services/profile.service', () => profileMock);
vi.mock('../src/services/oauth.service', () => ({
  buildOAuthRedirectUri: vi.fn(),
  createOAuthLoginCode: vi.fn(),
  exchangeOAuthLoginCode: vi.fn(),
}));

describe('auth controller service 경계', () => {
  it('getMe가 Prisma 대신 profile service를 사용한다', async () => {
    profileMock.getUserProfile.mockResolvedValue({ id: 'user-1' });
    const { getMe } = await import('../src/controllers/auth.controller');
    const json = vi.fn();

    await getMe({ userId: 'user-1' } as never, { json } as never, vi.fn());

    expect(profileMock.getUserProfile).toHaveBeenCalledWith('user-1');
    expect(json).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('refresh의 DB 장애를 401로 오인하지 않고 error middleware로 전달한다', async () => {
    const dbError = new Error('db unavailable');
    authMock.rotateRefreshToken.mockRejectedValue(dbError);
    const { refresh } = await import('../src/controllers/auth.controller');
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();

    await refresh({ body: { refreshToken: 'token' } } as never, { status, json } as never, next);

    expect(status).not.toHaveBeenCalledWith(401);
    expect(next).toHaveBeenCalledWith(dbError);
  });
});
