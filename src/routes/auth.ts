import { NextFunction, Request, Response, Router } from 'express';
import passport from 'passport';
import { Strategy as KakaoStrategy } from 'passport-kakao';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { upsertUser } from '../services/auth.service';
import { exchangeOAuthCode, handleSocialCallback, refresh, logout, getMe, completeProfile, deleteAccount, updateProfile, switchRole } from '../controllers/auth.controller';
import { kakaoSdkLogin, googleSdkLogin } from '../controllers/social.controller';
import { authenticate } from '../middlewares/authenticate';
import {
  buildOAuthRedirectUri,
  consumeOAuthTransaction,
  createOAuthTransaction,
  getOAuthRedirectUri,
  oauthClearCookieOptions,
  oauthCookieOptions,
  OAUTH_TRANSACTION_COOKIE,
  OAuthProvider,
  parseOAuthTarget,
  verifyOAuthTransaction,
} from '../services/oauth.service';

const router = Router();

function oauthStart(provider: OAuthProvider, scope?: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.query.redirectUri !== undefined) {
      res.status(400).json({ message: 'redirectUri is not supported; use target' });
      return;
    }

    const target = parseOAuthTarget(req.query.target);
    if (!target) {
      res.status(400).json({ message: 'target must be web or local' });
      return;
    }

    try {
      getOAuthRedirectUri(target);
      const { state, nonce } = await createOAuthTransaction(provider, target);
      res.cookie(OAUTH_TRANSACTION_COOKIE, nonce, oauthCookieOptions);
      passport.authenticate(provider, { ...(scope ? { scope } : {}), state })(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function oauthCallback(provider: OAuthProvider) {
  return (req: Request, res: Response, next: NextFunction) => {
    const transaction = verifyOAuthTransaction(req.query.state, req.headers.cookie, provider);
    if (!transaction) {
      res.status(400).json({ message: 'Invalid or expired OAuth state' });
      return;
    }

    passport.authenticate(provider, { session: false }, (error: unknown, user: Express.User | false) => {
      void (async () => {
        if (error) {
          res.clearCookie(OAUTH_TRANSACTION_COOKIE, oauthClearCookieOptions);
          next(error);
          return;
        }

        if (!user) {
          res.clearCookie(OAUTH_TRANSACTION_COOKIE, oauthClearCookieOptions);
          res.redirect(303, buildOAuthRedirectUri(transaction.redirectUri, { error: 'login_failed' }));
          return;
        }

        const consumed = await consumeOAuthTransaction(transaction);
        if (!consumed) {
          res.clearCookie(OAUTH_TRANSACTION_COOKIE, oauthClearCookieOptions);
          res.status(400).json({ message: 'Invalid or expired OAuth state' });
          return;
        }

        res.clearCookie(OAUTH_TRANSACTION_COOKIE, oauthClearCookieOptions);
        req.user = user;
        (req as Request & { oauthRedirectUri?: string }).oauthRedirectUri = transaction.redirectUri;
        next();
      })().catch(next);
    })(req, res, next);
  };
}

type PassportConfigurator = Pick<typeof passport, 'use'>;
const configuredPassportInstances = new WeakSet<object>();

/**
 * Application-bootstrap integration hook for OAuth strategy registration.
 * Importing this route module never mutates Passport's global strategy registry.
 * The application bootstrap must call this once before mounting `authRouter`:
 *
 * @example
 * import authRouter, { configureAuthPassport } from './routes/auth';
 * configureAuthPassport();
 * app.use('/auth', authRouter);
 */
export function configureAuthPassport(passportInstance: PassportConfigurator = passport): void {
  if (configuredPassportInstances.has(passportInstance)) return;

  if (process.env.KAKAO_CLIENT_ID) {
    passportInstance.use(
      new KakaoStrategy(
        {
          clientID: process.env.KAKAO_CLIENT_ID,
          clientSecret: process.env.KAKAO_CLIENT_SECRET,
          callbackURL: process.env.KAKAO_CALLBACK_URL!,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await upsertUser('kakao', String(profile.id), profile._json?.kakao_account?.email);
            done(null, user);
          } catch (error) {
            done(error);
          }
        },
      ),
    );
  }

  if (process.env.GOOGLE_CLIENT_ID) {
    passportInstance.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          callbackURL: process.env.GOOGLE_CALLBACK_URL!,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await upsertUser('google', profile.id, profile.emails?.[0]?.value);
            done(null, user);
          } catch (error) {
            done(error);
          }
        },
      ),
    );
  }

  configuredPassportInstances.add(passportInstance);
}

router.get('/kakao', oauthStart('kakao'));

router.get('/kakao/callback', oauthCallback('kakao'), handleSocialCallback);

router.get('/google', oauthStart('google', ['profile', 'email']));

router.get('/google/callback', oauthCallback('google'), handleSocialCallback);

router.post('/exchange', exchangeOAuthCode);

router.post('/refresh', refresh);

router.post('/logout', authenticate, logout);

router.get('/me', authenticate, getMe);

router.patch('/profile', authenticate, completeProfile);
router.patch('/me', authenticate, updateProfile);
router.delete('/me', authenticate, deleteAccount);
router.patch('/role', authenticate, switchRole);

router.post('/kakao/token', kakaoSdkLogin);

router.post('/google/token', googleSdkLogin);


export default router;
