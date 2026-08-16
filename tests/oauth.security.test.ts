import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const passportMock = vi.hoisted(() => ({
  capturedState: undefined as string | undefined,
  initialize: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  use: vi.fn(),
  authenticate: vi.fn((_strategy: string, options: { state?: string }, callback?: (error: unknown, user?: Express.User | false) => void) => {
    return (_req: unknown, res: { redirect: (status: number, location: string) => void }, _next: () => void) => {
      if (callback) {
        callback(null, { id: 'oauth-user', profileCompleted: false } as unknown as Express.User);
        return;
      }
      passportMock.capturedState = options?.state;
      res.redirect(302, 'https://provider.test/authorize');
    };
  }),
}));

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  oAuthLoginCode: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  oAuthTransaction: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  refreshTokenSession: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('passport', () => ({ default: passportMock }));
vi.mock('../src/prisma/client', () => ({ default: prismaMock }));
vi.mock('../src/services/ai.service', () => ({
  diagnose: vi.fn(),
  loadManualCache: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'oauth-access-secret-at-least-32-bytes-long';
  process.env.JWT_REFRESH_SECRET = 'oauth-refresh-secret-at-least-32-bytes-long';
  process.env.OAUTH_STATE_SECRET = 'oauth-state-secret-with-enough-entropy';
  process.env.OAUTH_WEB_REDIRECT_URI = 'https://frontend.test/auth';
  process.env.OAUTH_LOCAL_REDIRECT_URI = 'http://localhost:5173/auth';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  app = (await import('../src/app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  passportMock.capturedState = undefined;

  prismaMock.oAuthLoginCode.create.mockResolvedValue({ id: 1 });
  prismaMock.oAuthLoginCode.findUnique.mockResolvedValue({
    id: 1,
    userId: 'oauth-user',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
  });
  prismaMock.oAuthLoginCode.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.oAuthTransaction.create.mockResolvedValue({ nonceHash: 'stored-state' });
  prismaMock.oAuthTransaction.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.refreshTokenSession.create.mockResolvedValue({ tokenHash: 'stored-refresh-hash' });
  prismaMock.user.findUnique.mockResolvedValue({ id: 'oauth-user', profileCompleted: false });
  prismaMock.user.update.mockResolvedValue({ id: 'oauth-user' });
  prismaMock.$transaction.mockImplementation(async (operation: (client: typeof prismaMock) => Promise<unknown>) => operation(prismaMock));
});

async function startGoogleLogin() {
  const response = await request(app).get('/auth/google').query({ target: 'web' });
  const setCookies = response.headers['set-cookie'] as unknown as string[] | undefined;
  return {
    response,
    cookie: setCookies?.[0]?.split(';')[0],
    state: passportMock.capturedState,
  };
}

describe('OAuth 시작 요청', () => {
  it('사용자 입력 redirectUri를 거부한다', async () => {
    const response = await request(app)
      .get('/auth/google')
      .query({ redirectUri: 'https://attacker.example/callback' });

    expect(response.status).toBe(400);
    expect(passportMock.authenticate).not.toHaveBeenCalled();
  });

  it('알 수 없는 redirect target을 거부한다', async () => {
    const response = await request(app)
      .get('/auth/google')
      .query({ target: 'attacker' });

    expect(response.status).toBe(400);
    expect(passportMock.authenticate).not.toHaveBeenCalled();
  });

  it('고정된 web target에 대해 서명 state와 브라우저 쿠키를 발급한다', async () => {
    const { response, cookie, state } = await startGoogleLogin();

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://provider.test/authorize');
    expect(state).toEqual(expect.any(String));
    expect(cookie).toMatch(/^ilaw_oauth_tx=/);
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
    expect(prismaMock.oAuthTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nonceHash: expect.any(String),
        provider: 'google',
        target: 'web',
        expiresAt: expect.any(Date),
      }),
    });
    expect(prismaMock.oAuthTransaction.create.mock.calls[0][0].data.nonceHash).not.toContain(cookie!.split('=')[1]);
  });
});

describe('OAuth 콜백', () => {
  it('검증된 콜백에서 JWT가 아닌 일회용 code만 303으로 전달한다', async () => {
    const { cookie, state } = await startGoogleLogin();

    const response = await request(app)
      .get('/auth/google/callback')
      .set('Cookie', cookie!)
      .query({ state });

    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(/^https:\/\/frontend\.test\/auth\?code=/);
    expect(response.headers.location).not.toContain('accessToken');
    expect(response.headers.location).not.toContain('refreshToken');
    expect(response.text).not.toContain('<script>');
    expect(prismaMock.oAuthLoginCode.create).toHaveBeenCalledOnce();
    const code = new URL(response.headers.location).searchParams.get('code');
    expect(prismaMock.oAuthLoginCode.create.mock.calls[0][0].data.codeHash).not.toBe(code);
  });

  it('브라우저 트랜잭션 쿠키가 없으면 콜백을 거부한다', async () => {
    const { state } = await startGoogleLogin();

    const response = await request(app)
      .get('/auth/google/callback')
      .query({ state });

    expect(response.status).toBe(400);
    expect(prismaMock.oAuthLoginCode.create).not.toHaveBeenCalled();
  });

  it('변조된 state를 거부한다', async () => {
    const { cookie, state } = await startGoogleLogin();

    const response = await request(app)
      .get('/auth/google/callback')
      .set('Cookie', cookie!)
      .query({ state: `${state}tampered` });

    expect(response.status).toBe(400);
    expect(prismaMock.oAuthLoginCode.create).not.toHaveBeenCalled();
  });

  it('이미 사용한 state를 다시 사용할 수 없다', async () => {
    const { cookie, state } = await startGoogleLogin();
    prismaMock.oAuthTransaction.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await request(app)
      .get('/auth/google/callback')
      .set('Cookie', cookie!)
      .query({ state });
    const second = await request(app)
      .get('/auth/google/callback')
      .set('Cookie', cookie!)
      .query({ state });

    expect(first.status).toBe(303);
    expect(second.status).toBe(400);
    expect(prismaMock.oAuthLoginCode.create).toHaveBeenCalledOnce();
  });
});

describe('OAuth 일회용 code 교환', () => {
  it('유효한 code를 iLaw 토큰으로 교환한다', async () => {
    const response = await request(app)
      .post('/auth/exchange')
      .send({ code: 'valid-one-time-code' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      profileCompleted: false,
    });
    expect(prismaMock.oAuthLoginCode.updateMany).toHaveBeenCalledOnce();
    expect(prismaMock.refreshTokenSession.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(prismaMock.refreshTokenSession.create.mock.calls[0][0])).not.toContain(response.body.refreshToken);
  });

  it('code가 누락되면 400을 반환한다', async () => {
    const response = await request(app).post('/auth/exchange').send({});

    expect(response.status).toBe(400);
  });

  it('만료된 code를 거부한다', async () => {
    prismaMock.oAuthLoginCode.findUnique.mockResolvedValue({
      id: 1,
      userId: 'oauth-user',
      expiresAt: new Date(Date.now() - 1),
      usedAt: null,
    });

    const response = await request(app)
      .post('/auth/exchange')
      .send({ code: 'expired-code' });

    expect(response.status).toBe(401);
    expect(prismaMock.refreshTokenSession.create).not.toHaveBeenCalled();
  });

  it('이미 사용된 code를 거부한다', async () => {
    prismaMock.oAuthLoginCode.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .post('/auth/exchange')
      .send({ code: 'reused-code' });

    expect(response.status).toBe(401);
    expect(prismaMock.refreshTokenSession.create).not.toHaveBeenCalled();
  });
});
