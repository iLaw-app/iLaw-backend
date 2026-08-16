import { Router } from 'express';
import { createRateLimiter } from '../middlewares/rateLimit';
import { checkText } from '../controllers/moderation.controller';

// 입력 중 반복 호출되는 엔드포인트라 전역 한도와 별개로 IP당 분당 한도를 둔다 (app.ts에서 전역 리미터 앞에 마운트).
// 검사 자체는 DB 없이 수 ms라 넉넉히 잡고, 공유 IP(학교 등)를 고려한다.
export const moderationRateLimiter = createRateLimiter({
  windowMs: Number(process.env.MODERATION_CHECK_WINDOW_MS ?? 60_000),
  max: Number(process.env.MODERATION_CHECK_MAX ?? 600),
  message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
});

const router = Router();
router.post('/check', moderationRateLimiter.middleware, checkText);

export default router;
