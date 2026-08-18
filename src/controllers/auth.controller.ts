import { NextFunction, Request, Response } from 'express';
import {
  deleteUserAccount,
  InvalidRefreshTokenError,
  revokeRefreshTokens,
  rotateRefreshToken,
} from '../services/auth.service';
import {
  buildOAuthRedirectUri,
  createOAuthLoginCode,
  exchangeOAuthLoginCode,
} from '../services/oauth.service';
import { AuthRequest } from '../middlewares/authenticate';
import {
  completeUserProfile,
  getUserProfile,
  isUniqueConstraintError,
  setUserRole,
  updateUserProfile,
} from '../services/profile.service';

export async function handleSocialCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as { id: string; profileCompleted: boolean };
    const redirectUri = (req as Request & { oauthRedirectUri?: string }).oauthRedirectUri;
    if (!redirectUri) {
      res.status(400).json({ message: 'Invalid OAuth transaction' });
      return;
    }
    const code = await createOAuthLoginCode(user.id);
    res.redirect(303, buildOAuthRedirectUri(redirectUri, { code }));
  } catch (error) {
    next(error);
  }
}

export async function exchangeOAuthCode(req: Request, res: Response, next: NextFunction) {
  const { code } = req.body as { code?: unknown };
  if (typeof code !== 'string' || !code || code.length > 512) {
    res.status(400).json({ message: 'code is required' });
    return;
  }
  try {
    const tokens = await exchangeOAuthLoginCode(code);
    if (!tokens) {
      res.status(401).json({ message: 'Invalid or expired OAuth code' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json(tokens);
  } catch (error) {
    next(error);
  }
}

export async function completeProfile(req: AuthRequest, res: Response, next: NextFunction) {
  const {
    nickname, region, birthDate, gender,
    agreedTermsOfService, agreedPrivacyPolicy, agreedAge14, agreedMarketing,
  } = req.body as {
    nickname?: string; region?: string; birthDate?: string; gender?: string;
    agreedTermsOfService?: boolean; agreedPrivacyPolicy?: boolean;
    agreedAge14?: boolean; agreedMarketing?: boolean;
  };

  if (!nickname) {
    res.status(400).json({ message: 'nickname is required' });
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
    res.status(400).json({ message: '아이디는 영어, 숫자, _만 사용 가능합니다.' });
    return;
  }
  if (gender && !['male', 'female', 'other'].includes(gender)) {
    res.status(400).json({ message: 'gender must be male, female, or other' });
    return;
  }
  if (!agreedTermsOfService || !agreedPrivacyPolicy || !agreedAge14) {
    res.status(400).json({ message: 'required terms must be agreed' });
    return;
  }
  const parsedBirthDate = birthDate ? new Date(birthDate) : null;
  if (parsedBirthDate && isNaN(parsedBirthDate.getTime())) {
    res.status(400).json({ message: 'birthDate 형식이 올바르지 않습니다. (예: 1995-08-15)' });
    return;
  }

  try {
    const updated = await completeUserProfile(req.userId!, {
      nickname,
      region: region ?? null,
      birthDate: parsedBirthDate,
      gender: gender ?? null,
      agreedTermsOfService,
      agreedPrivacyPolicy,
      agreedAge14,
      agreedMarketing: !!agreedMarketing,
    });
    res.json(updated);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ message: 'nickname already taken' });
      return;
    }
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ message: 'refreshToken is required' });
    return;
  }
  try {
    res.json(await rotateRefreshToken(refreshToken));
  } catch (error) {
    if (error instanceof InvalidRefreshTokenError) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }
    next(error);
  }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await revokeRefreshTokens(req.userId!);
    res.json({ message: 'Logged out' });
  } catch (error) {
    next(error);
  }
}

export async function deleteAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await deleteUserAccount(req.userId!);
    res.json({ message: 'Account deleted' });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await getUserProfile(req.userId!);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
  const { nickname, region, birthDate, gender, affiliation } = req.body as {
    nickname?: string; region?: string; birthDate?: string; gender?: string; affiliation?: string;
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
    const updated = await updateUserProfile(req.userId!, {
      nickname, region, birthDate: parsedBirthDate, gender, affiliation: affiliation ?? null,
    });
    res.json(updated);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ message: 'nickname already taken' });
      return;
    }
    next(error);
  }
}

// 개발/테스트용 self role 전환 (마이페이지 앱버전 5탭).
// ALLOW_SELF_ROLE_SWITCH=true 일 때만 노출되고, 그 외에는 라우트가 없는 것처럼 404.
export function isSelfRoleSwitchEnabled(): boolean {
  return process.env.ALLOW_SELF_ROLE_SWITCH === 'true';
}

export async function switchRole(req: AuthRequest, res: Response, next: NextFunction) {
  if (!isSelfRoleSwitchEnabled()) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  const { role } = req.body as { role?: unknown };
  if (role !== 'user' && role !== 'lawyer') {
    res.status(400).json({ message: 'role must be user or lawyer' });
    return;
  }
  try {
    const updated = await setUserRole(req.userId!, role);
    res.json(updated);
  } catch (error) {
    next(error);
  }
}
