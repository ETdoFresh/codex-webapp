import express, { Request, Response } from 'express';

const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const serviceName = process.env.SERVICE_NAME ?? 'backend';
const app = express();
const startedAt = Date.now();

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: serviceName,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    startedAt
  });
});

// Provide a direct /api/health for situations where the proxy path is not rewritten.
app.get('/api/health', (_req: Request, res: Response) => {
  res.redirect(307, '/health');
});

const server = app.listen(PORT, () => {
  console.log(`[backend] listening on port ${PORT}`);
});

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
shutdownSignals.forEach((signal) => {
  process.on(signal, () => {
    console.log(`[backend] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
});
