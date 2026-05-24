import { Router } from 'express';
import { getPopular } from '../controllers/home.controller';

const router = Router();

router.get('/popular', getPopular);

export default router;
