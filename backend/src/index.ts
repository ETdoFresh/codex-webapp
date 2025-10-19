import express, { type NextFunction, type Request, type Response } from 'express';
import healthRoutes from './routes/healthRoutes';
import metaRoutes from './routes/metaRoutes';
import sessionRoutes from './routes/sessionRoutes';
import debugRoutes from './routes/debugRoutes';

const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

app.use(healthRoutes);
app.use(metaRoutes);
app.use(sessionRoutes);
app.use(debugRoutes);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).json({
    error: 'InternalServerError'
  });
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] listening on port ${PORT}`);
});

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
shutdownSignals.forEach((signal) => {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
});
