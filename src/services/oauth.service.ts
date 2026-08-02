import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import prisma from '../prisma/client';
import { generateAccessToken, generateRefreshToken } from './auth.service';

export type OAuthProvider = 'kakao' | 'google';
export type OAuthTarget = 'web' | 'local';

const STATE_TTL_MS = 5 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 60 * 1000;
export const OAUTH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const STATE_ISSUER = 'ilaw-backend';
const STATE_AUDIENCE = 'ilaw-oauth-callback';

export const OAUTH_TRANSACTION_COOKIE = 'ilaw_oauth_tx';

export const oauthCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/auth',
  maxAge: STATE_TTL_MS,
};

export const oauthClearCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/auth',
};

type OAuthStatePayload = JwtPayload & {
  nonce: string;
  provider: OAuthProvider;
  target: OAuthTarget;
};

export type VerifiedOAuthTransaction = {
  nonceHash: string;
  provider: OAuthProvider;
  target: OAuthTarget;
  redirectUri: string;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function getStateSecret() {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('OAUTH_STATE_SECRET must be at least 32 bytes');
  }
  return secret;
}

function isLoopbackUrl(url: URL) {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

export function parseOAuthTarget(value: unknown): OAuthTarget | null {
  if (value === 'web') return 'web';
  if (value === 'local' && process.env.NODE_ENV !== 'production') return 'local';
  return null;
}

export function getOAuthRedirectUri(target: OAuthTarget) {
  const configured = target === 'web'
    ? process.env.OAUTH_WEB_REDIRECT_URI
    : process.env.OAUTH_LOCAL_REDIRECT_URI;

  if (!configured) throw new Error(`OAuth ${target} redirect URI is not configured`);

  const url = new URL(configured);
  const isAllowed = target === 'web' ? url.protocol === 'https:' : isLoopbackUrl(url);
  if (!isAllowed || url.username || url.password || url.hash) {
    throw new Error(`OAuth ${target} redirect URI is invalid`);
  }

  return url.toString();
}

export function buildOAuthRedirectUri(baseUri: string, parameters: Record<string, string>) {
  const url = new URL(baseUri);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

export async function createOAuthTransaction(provider: OAuthProvider, target: OAuthTarget) {
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  const state = jwt.sign(
    { nonce, provider, target },
    getStateSecret(),
    {
      expiresIn: Math.floor(STATE_TTL_MS / 1000),
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
    },
  );

  await prisma.oAuthTransaction.create({
    data: {
      nonceHash: sha256(nonce),
      provider,
      target,
      expiresAt,
    },
  });

  return { state, nonce };
}

function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return null;
}

function equalSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyOAuthTransaction(
  state: unknown,
  cookieHeader: string | undefined,
  expectedProvider: OAuthProvider,
): VerifiedOAuthTransaction | null {
  if (typeof state !== 'string') return null;

  const cookieNonce = readCookie(cookieHeader, OAUTH_TRANSACTION_COOKIE);
  if (!cookieNonce) return null;

  try {
    const payload = jwt.verify(state, getStateSecret(), {
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
    }) as OAuthStatePayload;

    const target = parseOAuthTarget(payload.target);
    if (
      typeof payload.nonce !== 'string'
      || payload.provider !== expectedProvider
      || !target
      || !equalSecret(payload.nonce, cookieNonce)
    ) {
      return null;
    }

    return {
      nonceHash: sha256(payload.nonce),
      provider: expectedProvider,
      target,
      redirectUri: getOAuthRedirectUri(target),
    };
  } catch {
    return null;
  }
}

export async function consumeOAuthTransaction(transaction: VerifiedOAuthTransaction) {
  const result = await prisma.oAuthTransaction.deleteMany({
    where: {
      nonceHash: transaction.nonceHash,
      provider: transaction.provider,
      target: transaction.target,
      expiresAt: { gt: new Date() },
    },
  });

  return result.count === 1;
}

export async function createOAuthLoginCode(userId: string) {
  const code = randomBytes(32).toString('base64url');
  await prisma.oAuthLoginCode.create({
    data: {
      codeHash: sha256(code),
      userId,
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
    },
  });
  return code;
}

export async function exchangeOAuthLoginCode(code: string) {
  return prisma.$transaction(async (transaction) => {
    const storedCode = await transaction.oAuthLoginCode.findUnique({
      where: { codeHash: sha256(code) },
    });

    if (!storedCode || storedCode.usedAt || storedCode.expiresAt <= new Date()) return null;

    const consumed = await transaction.oAuthLoginCode.updateMany({
      where: {
        id: storedCode.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) return null;

    const user = await transaction.user.findUnique({
      where: { id: storedCode.userId },
      select: { id: true, profileCompleted: true },
    });
    if (!user) return null;

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    await transaction.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    return { accessToken, refreshToken, profileCompleted: user.profileCompleted };
  });
}

export async function cleanupExpiredOAuthRecords() {
  const now = new Date();
  await prisma.$transaction([
    prisma.oAuthTransaction.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.oAuthLoginCode.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { usedAt: { not: null } },
        ],
      },
    }),
  ]);
}
