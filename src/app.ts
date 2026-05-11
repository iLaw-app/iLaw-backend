import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import passport from 'passport';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger';
import authRouter from './routes/auth';
import manualRouter from './routes/manual';
import qnaRouter from './routes/qna';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

app.use('/auth', authRouter);
app.use('/manual', manualRouter);
app.use('/qna', qnaRouter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
