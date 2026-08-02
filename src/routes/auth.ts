import { NextFunction, Request, Response, Router } from 'express';
import passport from 'passport';
import { Strategy as KakaoStrategy } from 'passport-kakao';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { upsertUser } from '../services/auth.service';
import { exchangeOAuthCode, handleSocialCallback, refresh, logout, getMe, completeProfile, deleteAccount, updateProfile } from '../controllers/auth.controller';
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
        if (error || !user) {
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

if (process.env.KAKAO_CLIENT_ID) {
  passport.use(
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
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const user = await upsertUser('google', profile.id, email);
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

/**
 * @swagger
 * /auth/kakao:
 *   get:
 *     summary: 카카오 로그인
 *     description: 서명된 state와 브라우저 트랜잭션 쿠키를 발급하고 카카오 로그인 페이지로 리다이렉트합니다.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: target
 *         required: true
 *         schema:
 *           type: string
 *           enum: [web, local]
 *         description: 고정 리다이렉트 대상. local은 비운영 환경에서만 허용됩니다.
 *     responses:
 *       302:
 *         description: 카카오 로그인 페이지로 리다이렉트
 *       400:
 *         description: 허용되지 않은 target 또는 redirectUri 입력
 */
router.get('/kakao', oauthStart('kakao'));

/**
 * @swagger
 * /auth/kakao/callback:
 *   get:
 *     summary: 카카오 로그인 콜백
 *     description: state와 브라우저 트랜잭션을 검증한 뒤 고정된 프론트엔드 주소로 일회용 code를 전달합니다. JWT는 URL에 포함하지 않습니다.
 *     tags: [Auth]
 *     responses:
 *       303:
 *         description: 로그인 성공 후 ?code=...가 포함된 고정 프론트엔드 주소로 리다이렉트
 *       400:
 *         description: 유효하지 않거나 만료되었거나 이미 사용된 state
 */
router.get('/kakao/callback', oauthCallback('kakao'), handleSocialCallback);

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: 구글 로그인
 *     description: 서명된 state와 브라우저 트랜잭션 쿠키를 발급하고 구글 로그인 페이지로 리다이렉트합니다.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: target
 *         required: true
 *         schema:
 *           type: string
 *           enum: [web, local]
 *         description: 고정 리다이렉트 대상. local은 비운영 환경에서만 허용됩니다.
 *     responses:
 *       302:
 *         description: 구글 로그인 페이지로 리다이렉트
 *       400:
 *         description: 허용되지 않은 target 또는 redirectUri 입력
 */
router.get('/google', oauthStart('google', ['profile', 'email']));

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: 구글 로그인 콜백
 *     description: state와 브라우저 트랜잭션을 검증한 뒤 고정된 프론트엔드 주소로 일회용 code를 전달합니다. JWT는 URL에 포함하지 않습니다.
 *     tags: [Auth]
 *     responses:
 *       303:
 *         description: 로그인 성공 후 ?code=...가 포함된 고정 프론트엔드 주소로 리다이렉트
 *       400:
 *         description: 유효하지 않거나 만료되었거나 이미 사용된 state
 */
router.get('/google/callback', oauthCallback('google'), handleSocialCallback);

/**
 * @swagger
 * /auth/exchange:
 *   post:
 *     summary: OAuth 일회용 코드 교환
 *     description: OAuth 콜백으로 받은 일회용 code를 iLaw JWT로 교환합니다. code는 1분간 유효하며 한 번만 사용할 수 있습니다.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: 교환 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 *       400:
 *         description: code 누락
 *       401:
 *         description: 유효하지 않거나 만료되었거나 이미 사용된 code
 */
router.post('/exchange', exchangeOAuthCode);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Access Token 재발급
 *     description: Refresh Token으로 새로운 Access Token을 발급받습니다.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: eyJhbGci...
 *     responses:
 *       200:
 *         description: 토큰 재발급 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 *       401:
 *         description: 유효하지 않은 Refresh Token
 */
router.post('/refresh', refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: 로그아웃
 *     description: Refresh Token을 무효화합니다. Access Token이 필요합니다.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 로그아웃 성공
 *       401:
 *         description: 인증 실패
 */
router.post('/logout', authenticate, logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: 내 정보 조회
 *     description: 로그인한 유저의 정보를 반환합니다. Access Token이 필요합니다.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 유저 정보 반환
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: 인증 실패
 */
router.get('/me', authenticate, getMe);

/**
 * @swagger
 * /auth/profile:
 *   patch:
 *     summary: 온보딩 - 추가 정보 입력 및 약관 동의
 *     description: 소셜 로그인 후 닉네임, 지역, 출생연도, 성별, 약관 동의를 저장하고 profileCompleted를 true로 변경합니다.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nickname
 *               - region
 *               - birthYear
 *               - gender
 *               - agreedTermsOfService
 *               - agreedPrivacyPolicy
 *               - agreedAge14
 *             properties:
 *               nickname:
 *                 type: string
 *                 example: 홍길동
 *               region:
 *                 type: string
 *                 example: 서울특별시
 *               birthYear:
 *                 type: integer
 *                 example: 1995
 *               gender:
 *                 type: string
 *                 enum: [male, female, other]
 *               agreedTermsOfService:
 *                 type: boolean
 *               agreedPrivacyPolicy:
 *                 type: boolean
 *               agreedAge14:
 *                 type: boolean
 *               agreedMarketing:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 프로필 업데이트 성공
 *       400:
 *         description: 필수 필드 누락 또는 유효하지 않은 값
 *       409:
 *         description: 닉네임 중복
 */
router.patch('/profile', authenticate, completeProfile);
router.patch('/me', authenticate, updateProfile);
router.delete('/me', authenticate, deleteAccount);

/**
 * @swagger
 * /auth/kakao/token:
 *   post:
 *     summary: 카카오 SDK 로그인
 *     description: 카카오 SDK로 받은 accessToken으로 JWT를 발급합니다.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accessToken]
 *             properties:
 *               accessToken:
 *                 type: string
 *                 example: eyJhbGci...
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 *       401:
 *         description: 유효하지 않은 토큰
 */
router.post('/kakao/token', kakaoSdkLogin);

/**
 * @swagger
 * /auth/google/token:
 *   post:
 *     summary: 구글 SDK 로그인
 *     description: Google Sign-In SDK로 받은 idToken으로 JWT를 발급합니다.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 *                 example: eyJhbGci...
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 *       401:
 *         description: 유효하지 않은 토큰
 */
router.post('/google/token', googleSdkLogin);

/**
 * @swagger
 * components:
 *   schemas:
 *     TokenResponse:
 *       type: object
 *       properties:
 *         accessToken:
 *           type: string
 *           example: eyJhbGci...
 *         refreshToken:
 *           type: string
 *           example: eyJhbGci...
 *         profileCompleted:
 *           type: boolean
 *           description: 온보딩(추가 정보 입력) 완료 여부. false인 경우 PATCH /auth/profile 호출 필요
 *           example: false
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: cmorkvmmx0000139yevgthkpz
 *         email:
 *           type: string
 *           nullable: true
 *           example: user@example.com
 *         nickname:
 *           type: string
 *           nullable: true
 *           example: 홍길동
 *         region:
 *           type: string
 *           nullable: true
 *           example: 서울특별시
 *         birthYear:
 *           type: integer
 *           nullable: true
 *           example: 1995
 *         gender:
 *           type: string
 *           enum: [male, female, other]
 *           nullable: true
 *         provider:
 *           type: string
 *           enum: [kakao, google]
 *           example: kakao
 *         profileCompleted:
 *           type: boolean
 *           example: true
 *         agreedMarketing:
 *           type: boolean
 *           example: false
 *         createdAt:
 *           type: string
 *           format: date-time
 */

export default router;
