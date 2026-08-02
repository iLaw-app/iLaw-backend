import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import passport from 'passport';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger';
import authRouter from './routes/auth';
import manualRouter from './routes/manual';
import qnaRouter from './routes/qa';
import uploadRouter from './routes/upload';
import notificationsRouter from './routes/notifications';
import communityRouter from './routes/community';
import aiRouter from './routes/ai';
import homeRouter from './routes/home';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(cors());
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
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);

export default app;
