import { Request, Response } from 'express';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import { upsertUser, generateAccessToken, generateRefreshToken, saveRefreshToken } from '../services/auth.service';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function issueTokens(userId: string, profileCompleted: boolean, res: Response) {
  const accessToken = generateAccessToken(userId);
  const refreshToken = generateRefreshToken(userId);
  await saveRefreshToken(userId, refreshToken);
  res.json({ accessToken, refreshToken, profileCompleted });
}

export async function kakaoSdkLogin(req: Request, res: Response) {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) {
    res.status(400).json({ message: 'accessToken is required' });
    return;
  }

  try {
    const { data } = await axios.get('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const providerId = String(data.id);
    const email = data.kakao_account?.email;
    const user = await upsertUser('kakao', providerId, email);
    await issueTokens(user.id, user.profileCompleted, res);
  } catch {
    res.status(401).json({ message: 'Invalid Kakao access token' });
  }
}

export async function googleSdkLogin(req: Request, res: Response) {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) {
    res.status(400).json({ message: 'idToken is required' });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;

    const user = await upsertUser('google', payload.sub, payload.email);
    await issueTokens(user.id, user.profileCompleted, res);
  } catch {
    res.status(401).json({ message: 'Invalid Google id token' });
  }
}

export async function naverSdkLogin(req: Request, res: Response) {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) {
    res.status(400).json({ message: 'accessToken is required' });
    return;
  }

  try {
    const { data } = await axios.get('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profile = data.response;
    const user = await upsertUser('naver', profile.id, profile.email);
    await issueTokens(user.id, user.profileCompleted, res);
  } catch {
    res.status(401).json({ message: 'Invalid Naver access token' });
  }
}
