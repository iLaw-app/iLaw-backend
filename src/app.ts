import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import passport from 'passport';
import { buildCorsOptions } from './config/cors';
import authRouter, { configureAuthPassport } from './routes/auth';
import manualRouter from './routes/manual';
import qnaRouter from './routes/qa';
import uploadRouter from './routes/upload';
import notificationsRouter from './routes/notifications';
import communityRouter from './routes/community';
import aiRouter from './routes/ai';
import homeRouter from './routes/home';
import moderationRouter from './routes/moderation';
import { errorHandler } from './middlewares/errorHandler';
import prisma from './prisma/client';
import { createHealthRouter } from './health';
import { accessLogger, requestId } from './middlewares/logging';
import { globalRateLimiter } from './middlewares/rateLimit';
import { trustedProxy } from './config/trustedProxy';

const app = express();

configureAuthPassport();

const corsOptions = buildCorsOptions();

app.set('trust proxy', trustedProxy);
app.use(requestId);
app.use(accessLogger());
app.use('/health', createHealthRouter(prisma));
// 금칙어 사전 검사는 입력 중 디바운스로 반복 호출되므로 전역 한도를 소모하지 않게 자체 리미터로 분리한다.
// (학교처럼 IP를 공유하는 환경에서 글 하나 쓰다가 전체 API가 429로 막히는 일을 피한다.)
app.use('/moderation', cors(corsOptions), express.json(), moderationRouter);
app.use(globalRateLimiter.middleware);
app.use(cors(corsOptions));
app.use(express.json());
app.use(passport.initialize());

app.use('/auth', authRouter);
app.use('/manual', manualRouter);
app.use('/qna', qnaRouter);
app.use('/upload', uploadRouter);
app.use('/notifications', notificationsRouter);
app.use('/community', communityRouter);
app.use('/ai', aiRouter);
app.use('/home', homeRouter);

app.use(errorHandler);

export default app;
