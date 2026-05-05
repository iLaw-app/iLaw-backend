import { Request, Response } from 'express';
import {
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
} from '../services/auth.service';
import prisma from '../prisma/client';
import { AuthRequest } from '../middlewares/authenticate';

export async function handleSocialCallback(req: Request, res: Response) {
  const user = req.user as { id: string; profileCompleted: boolean };

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);

  res.json({ accessToken, refreshToken, profileCompleted: user.profileCompleted });
}

export async function completeProfile(req: AuthRequest, res: Response) {
  const {
    nickname,
    region,
    birthYear,
    gender,
    agreedTermsOfService,
    agreedPrivacyPolicy,
    agreedAge14,
    agreedMarketing,
  } = req.body as {
    nickname?: string;
    region?: string;
    birthYear?: number;
    gender?: string;
    agreedTermsOfService?: boolean;
    agreedPrivacyPolicy?: boolean;
    agreedAge14?: boolean;
    agreedMarketing?: boolean;
  };

  if (!nickname || !region || !birthYear || !gender) {
    res.status(400).json({ message: 'nickname, region, birthYear, gender are required' });
    return;
  }
  if (!['male', 'female', 'other'].includes(gender)) {
    res.status(400).json({ message: 'gender must be male, female, or other' });
    return;
  }
  if (!agreedTermsOfService || !agreedPrivacyPolicy || !agreedAge14) {
    res.status(400).json({ message: 'required terms must be agreed' });
    return;
  }

  try {
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: {
        nickname,
        region,
        birthYear,
        gender,
        agreedTermsOfService,
        agreedPrivacyPolicy,
        agreedAge14,
        agreedMarketing: !!agreedMarketing,
        agreedAt: new Date(),
        profileCompleted: true,
      },
      select: {
        id: true,
        email: true,
        nickname: true,
        region: true,
        birthYear: true,
        gender: true,
        profileCompleted: true,
      },
    });
    res.json(updated);
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') {
      res.status(409).json({ message: 'nickname already taken' });
      return;
    }
    throw e;
  }
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken: string };
  if (!refreshToken) {
    res.status(400).json({ message: 'refreshToken is required' });
    return;
  }

  try {
    const tokens = await rotateRefreshToken(refreshToken);
    res.json(tokens);
  } catch {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
}

export async function logout(req: AuthRequest, res: Response) {
  await prisma.user.update({
    where: { id: req.userId },
    data: { refreshToken: null },
  });
  res.json({ message: 'Logged out' });
}

export async function getMe(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
      nickname: true,
      region: true,
      birthYear: true,
      gender: true,
      provider: true,
      profileCompleted: true,
      agreedMarketing: true,
      createdAt: true,
    },
  });
  res.json(user);
}
