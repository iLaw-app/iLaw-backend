import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  refreshTokenSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../src/prisma/client', () => ({ default: prismaMock }));

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-bytes-long';
const REFRESH_SECRET = 'refresh-secret-that-is-at-least-32-bytes-long';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  prismaMock.refreshTokenSession.create.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (operation: (tx: typeof prismaMock) => Promise<unknown>) => operation(prismaMock));
});

describe('refresh token 저장', () => {
  it('고유 jti를 넣고 원문 대신 SHA-256 hash를 저장한다', async () => {
    const { generateRefreshToken, saveRefreshToken } = await import('../src/services/auth.service');
    const first = generateRefreshToken('user-1');
    const second = generateRefreshToken('user-1');

    const firstPayload = jwt.verify(first, REFRESH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const secondPayload = jwt.verify(second, REFRESH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    expect(firstPayload.jti).toEqual(expect.any(String));
    expect(firstPayload.jti).not.toBe(secondPayload.jti);

    await saveRefreshToken('user-1', first);

    const stored = prismaMock.refreshTokenSession.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(createHash('sha256').update(first).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(first);
    expect(stored.jti).toBe(firstPayload.jti);
    expect(stored.familyId).toEqual(expect.any(String));
  });
});

describe('refresh token rotation', () => {
  it('compare-and-swap에서 이긴 요청 하나만 새 토큰을 발급한다', async () => {
    const { generateRefreshToken, rotateRefreshToken, hashRefreshToken } = await import('../src/services/auth.service');
    const oldToken = generateRefreshToken('user-1', 'family-1');
    const oldPayload = jwt.verify(oldToken, REFRESH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const session = {
      jti: oldPayload.jti,
      tokenHash: hashRefreshToken(oldToken),
      familyId: 'family-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    };
    prismaMock.refreshTokenSession.findUnique.mockResolvedValue(session);
    prismaMock.refreshTokenSession.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });

    const results = await Promise.allSettled([
      rotateRefreshToken(oldToken),
      rotateRefreshToken(oldToken),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(prismaMock.refreshTokenSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tokenHash: session.tokenHash, revokedAt: null }),
    }));
  });

  it('이미 회전된 토큰 replay 시 해당 기기 family만 폐기한다', async () => {
    const { generateRefreshToken, rotateRefreshToken, hashRefreshToken } = await import('../src/services/auth.service');
    const replayed = generateRefreshToken('user-1', 'family-a');
    const payload = jwt.verify(replayed, REFRESH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    prismaMock.refreshTokenSession.findUnique.mockResolvedValue({
      jti: payload.jti,
      tokenHash: hashRefreshToken(replayed),
      familyId: 'family-a',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
    });
    prismaMock.refreshTokenSession.updateMany.mockResolvedValue({ count: 2 });

    await expect(rotateRefreshToken(replayed)).rejects.toMatchObject({ name: 'InvalidRefreshTokenError' });

    expect(prismaMock.refreshTokenSession.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-a', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('JWT 설정', () => {
  it('32 bytes 미만 secret을 거부한다', async () => {
    const { validateJwtConfiguration } = await import('../src/services/auth.service');
    expect(() => validateJwtConfiguration('short', REFRESH_SECRET)).toThrow(/32 bytes/);
  });

  it('access와 refresh secret이 같으면 거부한다', async () => {
    const { validateJwtConfiguration } = await import('../src/services/auth.service');
    expect(() => validateJwtConfiguration(ACCESS_SECRET, ACCESS_SECRET)).toThrow(/different/);
  });

  it('access token 검증에서 HS256 외 algorithm을 거부한다', async () => {
    const { verifyAccessToken } = await import('../src/services/auth.service');
    const token = jwt.sign({ userId: 'user-1' }, ACCESS_SECRET, { algorithm: 'HS384' });
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
