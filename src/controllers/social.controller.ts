import { NextFunction, Request, Response } from 'express';
import { issueTokenPair, upsertUser } from '../services/auth.service';
import {
  OAuthCredentialError,
  OAuthProviderUnavailableError,
  verifyGoogleIdToken,
  verifyKakaoAccessToken,
} from '../services/oauth-provider.service';

async function issueTokens(userId: string, profileCompleted: boolean, res: Response) {
  const tokens = await issueTokenPair(userId);
  res.json({ ...tokens, profileCompleted });
}

function handleProviderError(error: unknown, invalidMessage: string, res: Response, next: NextFunction) {
  if (error instanceof OAuthCredentialError) {
    res.status(401).json({ message: invalidMessage });
    return;
  }
  if (error instanceof OAuthProviderUnavailableError) {
    res.status(503).json({ message: 'OAuth provider temporarily unavailable' });
    return;
  }
  next(error);
}

export async function kakaoSdkLogin(req: Request, res: Response, next: NextFunction) {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) {
    res.status(400).json({ message: 'accessToken is required' });
    return;
  }

  try {
    const identity = await verifyKakaoAccessToken(accessToken);
    const user = await upsertUser('kakao', identity.providerId, identity.email);
    await issueTokens(user.id, user.profileCompleted, res);
  } catch (error) {
    handleProviderError(error, 'Invalid Kakao access token', res, next);
  }
}

export async function googleSdkLogin(req: Request, res: Response, next: NextFunction) {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) {
    res.status(400).json({ message: 'idToken is required' });
    return;
  }

  try {
    const identity = await verifyGoogleIdToken(idToken);
    const user = await upsertUser('google', identity.providerId, identity.email);
    await issueTokens(user.id, user.profileCompleted, res);
  } catch (error) {
    handleProviderError(error, 'Invalid Google id token', res, next);
  }
}
