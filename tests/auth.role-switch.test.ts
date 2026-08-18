import { afterEach, describe, expect, it, vi } from 'vitest';

const profileMock = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  completeUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  isUniqueConstraintError: vi.fn(),
  setUserRole: vi.fn(),
}));

vi.mock('../src/services/auth.service', () => ({
  rotateRefreshToken: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  deleteUserAccount: vi.fn(),
  InvalidRefreshTokenError: class InvalidRefreshTokenError extends Error {},
}));
vi.mock('../src/services/profile.service', () => profileMock);
vi.mock('../src/services/oauth.service', () => ({
  buildOAuthRedirectUri: vi.fn(),
  createOAuthLoginCode: vi.fn(),
  exchangeOAuthLoginCode: vi.fn(),
}));

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('PATCH /auth/role (self role switch)', () => {
  const originalFlag = process.env.ALLOW_SELF_ROLE_SWITCH;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ALLOW_SELF_ROLE_SWITCH;
    else process.env.ALLOW_SELF_ROLE_SWITCH = originalFlag;
    profileMock.setUserRole.mockReset();
  });

  it('플래그가 꺼져 있으면 404를 반환하고 DB를 건드리지 않는다', async () => {
    delete process.env.ALLOW_SELF_ROLE_SWITCH;
    const { switchRole } = await import('../src/controllers/auth.controller');
    const res = mockRes();

    await switchRole({ userId: 'u1', body: { role: 'lawyer' } } as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(profileMock.setUserRole).not.toHaveBeenCalled();
  });

  it('플래그가 켜져 있어도 role 값이 잘못되면 400', async () => {
    process.env.ALLOW_SELF_ROLE_SWITCH = 'true';
    const { switchRole } = await import('../src/controllers/auth.controller');
    const res = mockRes();

    await switchRole({ userId: 'u1', body: { role: 'admin' } } as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(profileMock.setUserRole).not.toHaveBeenCalled();
  });

  it('플래그가 켜져 있으면 본인 role을 바꾸고 결과를 반환한다', async () => {
    process.env.ALLOW_SELF_ROLE_SWITCH = 'true';
    profileMock.setUserRole.mockResolvedValue({ id: 'u1', role: 'lawyer' });
    const { switchRole } = await import('../src/controllers/auth.controller');
    const res = mockRes();

    await switchRole({ userId: 'u1', body: { role: 'lawyer' } } as never, res as never, vi.fn());

    expect(profileMock.setUserRole).toHaveBeenCalledWith('u1', 'lawyer');
    expect(res.json).toHaveBeenCalledWith({ id: 'u1', role: 'lawyer' });
  });

  it('DB 오류는 error middleware로 전달한다', async () => {
    process.env.ALLOW_SELF_ROLE_SWITCH = 'true';
    const dbError = new Error('db down');
    profileMock.setUserRole.mockRejectedValue(dbError);
    const { switchRole } = await import('../src/controllers/auth.controller');
    const res = mockRes();
    const next = vi.fn();

    await switchRole({ userId: 'u1', body: { role: 'user' } } as never, res as never, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
