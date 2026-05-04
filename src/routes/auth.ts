import { Router } from 'express';
import passport from 'passport';
import { Strategy as KakaoStrategy } from 'passport-kakao';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as NaverStrategy } from 'passport-naver-v2';
import { upsertUser } from '../services/auth.service';
import { handleSocialCallback, refresh, logout, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/authenticate';

const router = Router();

if (process.env.KAKAO_CLIENT_ID) {
  passport.use(
    new KakaoStrategy(
      {
        clientID: process.env.KAKAO_CLIENT_ID,
        clientSecret: process.env.KAKAO_CLIENT_SECRET,
        callbackURL: process.env.KAKAO_CALLBACK_URL!,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        const user = await upsertUser('kakao', String(profile.id), profile._json?.kakao_account?.email, profile.displayName);
        done(null, user);
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
        const email = profile.emails?.[0]?.value;
        const user = await upsertUser('google', profile.id, email, profile.displayName);
        done(null, user);
      }
    )
  );
}

if (process.env.NAVER_CLIENT_ID) {
  passport.use(
    new NaverStrategy(
      {
        clientID: process.env.NAVER_CLIENT_ID,
        clientSecret: process.env.NAVER_CLIENT_SECRET!,
        callbackURL: process.env.NAVER_CALLBACK_URL!,
      },
      async (_accessToken: string, _refreshToken: string, profile: { id: string; displayName: string; email?: string }, done: (err: unknown, user?: Express.User | false) => void) => {
        const user = await upsertUser('naver', profile.id, profile.email, profile.displayName);
        done(null, user);
      }
    )
  );
}

/**
 * @swagger
 * /auth/kakao:
 *   get:
 *     summary: 카카오 로그인
 *     description: 카카오 OAuth 로그인 페이지로 리다이렉트합니다.
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: 카카오 로그인 페이지로 리다이렉트
 */
router.get('/kakao', passport.authenticate('kakao'));

/**
 * @swagger
 * /auth/kakao/callback:
 *   get:
 *     summary: 카카오 로그인 콜백
 *     description: 카카오 로그인 완료 후 JWT 토큰을 반환합니다.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 */
router.get('/kakao/callback', passport.authenticate('kakao', { session: false }), handleSocialCallback);

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: 구글 로그인
 *     description: 구글 OAuth 로그인 페이지로 리다이렉트합니다.
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: 구글 로그인 페이지로 리다이렉트
 */
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', { session: false }), handleSocialCallback);

/**
 * @swagger
 * /auth/naver:
 *   get:
 *     summary: 네이버 로그인
 *     description: 네이버 OAuth 로그인 페이지로 리다이렉트합니다.
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: 네이버 로그인 페이지로 리다이렉트
 */
router.get('/naver', passport.authenticate('naver'));
router.get('/naver/callback', passport.authenticate('naver', { session: false }), handleSocialCallback);

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
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: cmorkvmmx0000139yevgthkpz
 *         email:
 *           type: string
 *           example: user@example.com
 *         nickname:
 *           type: string
 *           example: 홍길동
 *         provider:
 *           type: string
 *           example: kakao
 *         createdAt:
 *           type: string
 *           format: date-time
 */

export default router;
