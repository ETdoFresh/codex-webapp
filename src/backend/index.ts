import type { Application, NextFunction, Request, Response } from 'express';
import express from 'express';
import healthRoutes from './routes/healthRoutes';
import metaRoutes from './routes/metaRoutes';
import sessionRoutes from './routes/sessionRoutes';
import debugRoutes from './routes/debugRoutes';

export function registerBackend(app: Application): void {
  app.use(express.json({ limit: '20mb' }));
  app.use(healthRoutes);
  app.use(metaRoutes);
  app.use(sessionRoutes);
  app.use(debugRoutes);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({
      error: 'InternalServerError'
    });
  });
}

export default registerBackend;
