import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import registerBackend from './backend/index.js';

const DEFAULT_PORT = 3000;
const MAX_PORT_SEARCH = 20;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const frontendRoot = path.resolve(dirname, 'frontend');
const clientDistPath = path.resolve(repoRoot, 'dist/client');
const indexHtmlPath = path.resolve(frontendRoot, 'index.html');
const isProduction = process.env.NODE_ENV === 'production';

type StartResult = {
  server: Server;
  port: number;
  vite?: ViteDevServer;
};

const sanitizeNodeOptions = () => {
  const value = process.env.NODE_OPTIONS;
  if (!value || value.trim() === '') {
    return;
  }

  const filtered = value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !token.startsWith('--inspect'));

  if (filtered.length === 0) {
    delete process.env.NODE_OPTIONS;
    return;
  }

  process.env.NODE_OPTIONS = filtered.join(' ');
};

const resolveCodexPath = (): string | null => {
  if (process.env.CODEX_PATH && process.env.CODEX_PATH.trim() !== '') {
    return process.env.CODEX_PATH;
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, ['codex'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? null;
};

const ensureCodexPath = () => {
  const resolved = resolveCodexPath();
  if (resolved && !process.env.CODEX_PATH) {
    process.env.CODEX_PATH = resolved;
  }
};

const attachBackend = (app: Application) => {
  registerBackend(app);
};

const registerFrontendMiddleware = async (app: Application): Promise<ViteDevServer | undefined> => {
  if (isProduction) {
    app.use(express.static(clientDistPath));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }

      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
    return undefined;
  }

  const vite = await createViteServer({
    configFile: path.resolve(repoRoot, 'vite.config.ts'),
    root: frontendRoot,
    server: {
      middlewareMode: true,
      watch: {
        // Use polling on Windows containers where FS events can be flaky.
        usePolling: process.env.VITE_WATCH_USE_POLLING === '1'
      }
    },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  app.use('*', async (req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl?.startsWith('/api')) {
      next();
      return;
    }

    try {
      const template = await fs.readFile(indexHtmlPath, 'utf-8');
      const transformed = await vite.transformIndexHtml(req.originalUrl ?? '/', template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(transformed);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });

  return vite;
};

const listenWithRetry = async (app: Application, startPort: number): Promise<StartResult> => {
  let currentPort = startPort;
  for (let attempts = 0; attempts < MAX_PORT_SEARCH; attempts += 1) {
    const httpServer = createHttpServer(app);
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', (error: NodeJS.ErrnoException) => {
          httpServer.close();
          reject(error);
        });
        httpServer.listen(currentPort, resolve);
      });

      return { server: httpServer, port: currentPort };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EADDRINUSE') {
        currentPort += 1;
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to bind server after trying ${MAX_PORT_SEARCH} ports starting at ${startPort}`);
};

const start = async () => {
  sanitizeNodeOptions();
  ensureCodexPath();

  const app = express();
  app.disable('x-powered-by');

  attachBackend(app);
  const vite = await registerFrontendMiddleware(app);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    if (res.headersSent) {
      return;
    }

    res.status(500).json({ error: 'InternalServerError' });
  });

  const startPort = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  const { server, port } = await listenWithRetry(app, startPort);

  if (vite) {
    vite.httpServer = server;
  }

  console.log(`[codex-webapp] listening on http://localhost:${port}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[codex-webapp] received ${signal}, shutting down`);

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    if (vite) {
      await vite.close();
    }

    process.exit(0);
  };

  const handleError = (error: unknown) => {
    console.error('[codex-webapp] fatal error', error);
    process.exit(1);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', handleError);
  process.on('unhandledRejection', handleError);
};

start().catch((error) => {
  console.error('[codex-webapp] failed to start', error);
  process.exit(1);
});
