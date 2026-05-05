import { Router } from 'express';
import passport from 'passport';
import { Strategy as KakaoStrategy } from 'passport-kakao';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as NaverStrategy } from 'passport-naver-v2';
import { upsertUser } from '../services/auth.service';
import { handleSocialCallback, refresh, logout, getMe, completeProfile } from '../controllers/auth.controller';
import { kakaoSdkLogin, googleSdkLogin, naverSdkLogin } from '../controllers/social.controller';
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
        const user = await upsertUser('kakao', String(profile.id), profile._json?.kakao_account?.email);
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
        const user = await upsertUser('google', profile.id, email);
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
        const user = await upsertUser('naver', profile.id, profile.email);
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

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: 구글 로그인 콜백
 *     description: 구글 로그인 완료 후 JWT 토큰을 반환합니다.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 */
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

/**
 * @swagger
 * /auth/naver/callback:
 *   get:
 *     summary: 네이버 로그인 콜백
 *     description: 네이버 로그인 완료 후 JWT 토큰을 반환합니다.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 */
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
 * /auth/naver/token:
 *   post:
 *     summary: 네이버 SDK 로그인
 *     description: 네이버 SDK로 받은 accessToken으로 JWT를 발급합니다.
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
router.post('/naver/token', naverSdkLogin);

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
 *           enum: [kakao, google, naver]
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
