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
  try {
    const user = req.user as { id: string; profileCompleted: boolean };
    const appRedirectUri = (req as Request & { appRedirectUri?: string }).appRedirectUri ?? 'ilaw://auth';

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);

    const deepLink = `${appRedirectUri}?accessToken=${accessToken}&refreshToken=${refreshToken}&profileCompleted=${user.profileCompleted}`;
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>window.location.href='${deepLink}';</script></body></html>`);
  } catch {
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
}

export async function completeProfile(req: AuthRequest, res: Response) {
  const {
    nickname,
    region,
    birthDate,
    gender,
    agreedTermsOfService,
    agreedPrivacyPolicy,
    agreedAge14,
    agreedMarketing,
  } = req.body as {
    nickname?: string;
    region?: string;
    birthDate?: string;
    gender?: string;
    agreedTermsOfService?: boolean;
    agreedPrivacyPolicy?: boolean;
    agreedAge14?: boolean;
    agreedMarketing?: boolean;
  };

  if (!nickname || !region || !birthDate || !gender) {
    res.status(400).json({ message: 'nickname, region, birthDate, gender are required' });
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
    res.status(400).json({ message: '아이디는 영어, 숫자, _만 사용 가능합니다.' });
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

  const parsedBirthDate = new Date(birthDate);
  if (isNaN(parsedBirthDate.getTime())) {
    res.status(400).json({ message: 'birthDate 형식이 올바르지 않습니다. (예: 1995-08-15)' });
    return;
  }

  try {
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: {
        nickname,
        region,
        birthDate: parsedBirthDate,
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
        birthDate: true,
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
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { refreshToken: null },
    });
    res.json({ message: 'Logged out' });
  } catch {
    res.status(500).json({ message: 'Logout failed. Please try again.' });
  }
}

export async function deleteAccount(req: AuthRequest, res: Response) {
  try {
    await prisma.user.delete({ where: { id: req.userId } });
    res.json({ message: 'Account deleted' });
  } catch {
    res.status(500).json({ message: 'Failed to delete account.' });
  }
}

export async function getMe(req: AuthRequest, res: Response) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        region: true,
        birthDate: true,
        gender: true,
        provider: true,
        profileCompleted: true,
        role: true,
        affiliation: true,
        agreedMarketing: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json(user);
  } catch {
    res.status(500).json({ message: 'Failed to fetch user info.' });
  }
}

export async function updateProfile(req: AuthRequest, res: Response) {
  const { nickname, region, birthDate, gender, affiliation } = req.body as {
    nickname?: string;
    region?: string;
    birthDate?: string;
    gender?: string;
    affiliation?: string;
  };

  if (!nickname || !region || !birthDate || !gender) {
    res.status(400).json({ message: 'nickname, region, birthDate, gender are required' });
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
    res.status(400).json({ message: '아이디는 영어, 숫자, _만 사용 가능합니다.' });
    return;
  }
  if (!['male', 'female', 'other'].includes(gender)) {
    res.status(400).json({ message: 'gender must be male, female, or other' });
    return;
  }

  const parsedBirthDate = new Date(birthDate);
  if (isNaN(parsedBirthDate.getTime())) {
    res.status(400).json({ message: 'birthDate 형식이 올바르지 않습니다. (예: 1995-08-15)' });
    return;
  }

  try {
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { nickname, region, birthDate: parsedBirthDate, gender, affiliation: affiliation ?? null },
      select: { id: true, nickname: true, region: true, birthDate: true, gender: true, affiliation: true },
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

export async function devSetRole(req: AuthRequest, res: Response) {
  const { role } = req.body as { role?: string };
  if (role !== 'user' && role !== 'lawyer') {
    res.status(400).json({ message: 'role must be user or lawyer' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { role },
    select: { id: true, role: true },
  });
  res.json(user);
}
