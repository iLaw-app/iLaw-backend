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
import { errorHandler } from './middlewares/errorHandler';
import prisma from './prisma/client';
import { createHealthRouter } from './health';
import { accessLogger, requestId } from './middlewares/logging';
import { globalRateLimiter } from './middlewares/rateLimit';

const app = express();

configureAuthPassport();

app.set('trust proxy', 1);
app.use(requestId);
app.use(accessLogger());
app.use('/health', createHealthRouter(prisma));
app.use(globalRateLimiter.middleware);
app.use(cors(buildCorsOptions()));
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
