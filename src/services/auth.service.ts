import { createHash, randomUUID } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../prisma/client';

export const JWT_ALGORITHM = 'HS256' as const;
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '30d';

type RefreshPayload = JwtPayload & {
  userId: string;
  tokenUse: 'refresh';
  jti: string;
  familyId: string;
};

type RefreshStore = Pick<PrismaClient, 'refreshTokenSession'> | Pick<Prisma.TransactionClient, 'refreshTokenSession'>;

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Invalid refresh token');
    this.name = 'InvalidRefreshTokenError';
  }
}

export function validateJwtConfiguration(accessSecret: string | undefined, refreshSecret: string | undefined) {
  if (!accessSecret || Buffer.byteLength(accessSecret, 'utf8') < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 bytes');
  }
  if (!refreshSecret || Buffer.byteLength(refreshSecret, 'utf8') < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 bytes');
  }
  if (accessSecret === refreshSecret) {
    throw new Error('JWT access and refresh secrets must be different');
  }
  return { accessSecret, refreshSecret };
}

function jwtSecrets() {
  return validateJwtConfiguration(process.env.JWT_ACCESS_SECRET, process.env.JWT_REFRESH_SECRET);
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateAccessToken(userId: string) {
  const { accessSecret } = jwtSecrets();
  return jwt.sign({ userId, tokenUse: 'access' }, accessSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string) {
  // Startup validation in config/env enforces strength and separation. Keeping
  // verification dependent only on the access secret also avoids coupling access
  // validation to refresh-token configuration in isolated middleware consumers.
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is required');
  const payload = jwt.verify(token, accessSecret, { algorithms: [JWT_ALGORITHM] });
  if (
    typeof payload === 'string'
    || (payload.tokenUse !== undefined && payload.tokenUse !== 'access')
    || typeof payload.userId !== 'string'
  ) {
    throw new jwt.JsonWebTokenError('Invalid access token claims');
  }
  return payload as JwtPayload & { userId: string; tokenUse: 'access' };
}

export function generateRefreshToken(userId: string, familyId: string = randomUUID()) {
  const { refreshSecret } = jwtSecrets();
  return jwt.sign({ userId, tokenUse: 'refresh', familyId }, refreshSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: REFRESH_TOKEN_TTL,
    jwtid: randomUUID(),
  });
}

function verifyRefreshToken(token: string): RefreshPayload {
  const { refreshSecret } = jwtSecrets();
  const payload = jwt.verify(token, refreshSecret, { algorithms: [JWT_ALGORITHM] });
  if (
    typeof payload === 'string'
    || payload.tokenUse !== 'refresh'
    || typeof payload.userId !== 'string'
    || typeof payload.jti !== 'string'
    || typeof payload.familyId !== 'string'
    || typeof payload.exp !== 'number'
  ) {
    throw new InvalidRefreshTokenError();
  }
  return payload as RefreshPayload;
}

export async function upsertUser(provider: string, providerId: string, email?: string) {
  return prisma.user.upsert({
    where: { provider_providerId: { provider, providerId } },
    update: { email },
    create: { provider, providerId, email },
  });
}

export async function saveRefreshToken(userId: string, refreshToken: string, store: RefreshStore = prisma) {
  const payload = verifyRefreshToken(refreshToken);
  if (payload.userId !== userId) throw new InvalidRefreshTokenError();
  const expiresAt = payload.exp;
  if (typeof expiresAt !== 'number') throw new InvalidRefreshTokenError();

  await store.refreshTokenSession.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      jti: payload.jti,
      familyId: payload.familyId,
      userId,
      expiresAt: new Date(expiresAt * 1000),
    },
  });
}

export async function issueTokenPair(userId: string, store: RefreshStore = prisma, familyId: string = randomUUID()) {
  const accessToken = generateAccessToken(userId);
  const refreshToken = generateRefreshToken(userId, familyId);
  await saveRefreshToken(userId, refreshToken, store);
  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(oldToken: string) {
  let payload: RefreshPayload;
  try {
    payload = verifyRefreshToken(oldToken);
  } catch {
    throw new InvalidRefreshTokenError();
  }

  const oldHash = hashRefreshToken(oldToken);
  const outcome = await prisma.$transaction(async (transaction) => {
    const session = await transaction.refreshTokenSession.findUnique({ where: { tokenHash: oldHash } });
    if (!session || session.userId !== payload.userId || session.jti !== payload.jti || session.familyId !== payload.familyId) {
      return { status: 'invalid' as const };
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      await transaction.refreshTokenSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { status: 'replay' as const };
    }

    const consumed = await transaction.refreshTokenSession.updateMany({
      where: {
        tokenHash: oldHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    if (consumed.count !== 1) {
      await transaction.refreshTokenSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { status: 'replay' as const };
    }

    const tokens = await issueTokenPair(session.userId, transaction, session.familyId);
    return { status: 'ok' as const, tokens };
  });

  if (outcome.status !== 'ok') throw new InvalidRefreshTokenError();
  return outcome.tokens;
}

export async function revokeRefreshTokens(userId: string) {
  await prisma.refreshTokenSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function deleteUserAccount(userId: string) {
  await prisma.user.delete({ where: { id: userId } });
}
