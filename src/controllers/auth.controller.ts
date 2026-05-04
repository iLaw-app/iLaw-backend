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
  const user = req.user as { id: string };

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);

  res.json({ accessToken, refreshToken });
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
    select: { id: true, email: true, nickname: true, provider: true, createdAt: true },
  });
  res.json(user);
}
