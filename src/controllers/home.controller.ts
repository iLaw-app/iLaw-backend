import { Request, Response, NextFunction } from 'express';
import { getPopularContent } from '../services/home.service';

export async function getPopular(_req: Request, res: Response, next: NextFunction) {
  try {
    const items = await getPopularContent();
    res.json(items);
  } catch (err) {
    next(err);
  }
}
