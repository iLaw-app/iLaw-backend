import jwt from 'jsonwebtoken';
import prisma from '../prisma/client';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export function generateAccessToken(userId: string) {
  return jwt.sign({ userId }, ACCESS_SECRET, { expiresIn: '1h' });
}

export function generateRefreshToken(userId: string) {
  return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: '30d' });
}

export async function upsertUser(provider: string, providerId: string, email?: string, nickname?: string) {
  return prisma.user.upsert({
    where: { provider_providerId: { provider, providerId } },
    update: { email, nickname },
    create: { provider, providerId, email, nickname },
  });
}

export async function saveRefreshToken(userId: string, refreshToken: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken },
  });
}

export async function rotateRefreshToken(oldToken: string) {
  const payload = jwt.verify(oldToken, REFRESH_SECRET) as { userId: string };
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });

  if (!user || user.refreshToken !== oldToken) {
    throw new Error('Invalid refresh token');
  }

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);

  return { accessToken, refreshToken };
}
