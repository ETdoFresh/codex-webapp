import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const DEFAULT_PORT = 3000;
const MAX_PORT_SEARCH = 20;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const frontendRoot = path.resolve(dirname, 'frontend');
const clientDistPath = path.resolve(repoRoot, 'dist/client');
const indexHtmlPath = path.resolve(frontendRoot, 'index.html');
const isProduction = process.env.NODE_ENV === 'production';
const codexVendorRoot = path.resolve(repoRoot, 'node_modules/@openai/codex-sdk/vendor');

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

const normalizeCodexBinaryPath = (candidate: string | null | undefined): string | null => {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const attempts: string[] = [];
  if (process.platform === 'win32') {
    const ext = path.extname(trimmed).toLowerCase();
    const windowsExtensions = ['.exe', '.cmd', '.bat', '.ps1'];
    if (!windowsExtensions.includes(ext)) {
      for (const suffix of windowsExtensions) {
        attempts.push(`${trimmed}${suffix}`);
      }
    }
  }
  attempts.push(trimmed);

  for (const testPath of attempts) {
    try {
      const stats = fsSync.statSync(testPath);
      if (stats.isFile()) {
        return testPath;
      }
    } catch {
      // ignore and keep trying
    }
  }

  return null;
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

  return normalizeCodexBinaryPath(firstLine);
};

const bundledCodexCandidates = (): string[] => {
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const preferred = (() => {
    if (process.platform === 'win32') {
      if (process.arch === 'x64') {
        return 'x86_64-pc-windows-msvc';
      }
      if (process.arch === 'arm64') {
        return 'aarch64-pc-windows-msvc';
      }
    }
    if (process.platform === 'darwin') {
      if (process.arch === 'x64') {
        return 'x86_64-apple-darwin';
      }
      if (process.arch === 'arm64') {
        return 'aarch64-apple-darwin';
      }
    }
    if (process.platform === 'linux') {
      if (process.arch === 'x64') {
        return 'x86_64-unknown-linux-gnu';
      }
      if (process.arch === 'arm64') {
        return 'aarch64-unknown-linux-gnu';
      }
    }
    return null;
  })();

  const candidates: string[] = [];
  const pushCandidate = (relative: string) => {
    candidates.push(path.join(codexVendorRoot, relative, 'codex', binaryName));
  };

  if (preferred) {
    pushCandidate(preferred);
  }

  try {
    const entries = fsSync.readdirSync(codexVendorRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const name = entry.name;
      if (preferred && name === preferred) {
        continue;
      }
      pushCandidate(name);
    }
  } catch {
    // ignore, fall through with any candidates already collected
  }

  return candidates;
};

const findBundledCodexPath = (): string | null => {
  for (const candidate of bundledCodexCandidates()) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const ensureCodexPath = () => {
  const normalizedCurrent = normalizeCodexBinaryPath(process.env.CODEX_PATH);
  if (normalizedCurrent) {
    process.env.CODEX_PATH = normalizedCurrent;
    console.log(`[codex-webapp] using CODEX_PATH=${normalizedCurrent}`);
    return;
  }

  const originalCurrent = process.env.CODEX_PATH?.trim();
  if (originalCurrent) {
    console.warn(
      `[codex-webapp] CODEX_PATH=${originalCurrent} is invalid, clearing and retrying resolution.`
    );
    delete process.env.CODEX_PATH;
  }

  const resolved = findBundledCodexPath() ?? resolveCodexPath();
  if (resolved) {
    process.env.CODEX_PATH = resolved;
    console.log(`[codex-webapp] using CODEX_PATH=${resolved}`);
  }
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

  const { default: registerBackend } = await import('./backend/index.js');
  registerBackend(app);
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
