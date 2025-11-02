import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import database from '../db';

const router = Router();
const serviceName = process.env.SERVICE_NAME ?? 'backend';

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: serviceName,
    timestamp: new Date().toISOString(),
    databasePath: path.relative(process.cwd(), database.getDatabasePath())
  });
});

router.get('/api/health', (_req: Request, res: Response) => {
  res.redirect(307, '/health');
});

export default router;
