import express, { Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { RequestHandler as ProxyRequestHandler } from 'http-proxy-middleware';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
const DEFAULT_BACKEND_URL = 'http://localhost:4000';
const DEFAULT_PORT = 3000;
const MAX_PORT_SEARCH = 20;

const FRONTEND_URL = process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
const BACKEND_URL = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
const START_PORT = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fallbackStaticDir = path.resolve(dirname, '../../frontend/dist');
const staticDir =
  process.env.FRONTEND_STATIC_DIR && process.env.FRONTEND_STATIC_DIR.trim() !== ''
    ? path.resolve(process.cwd(), process.env.FRONTEND_STATIC_DIR)
    : fallbackStaticDir;
const staticDirExists = fs.existsSync(staticDir);

const app = express();
app.disable('x-powered-by');
const probe = async (url: string) => {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return { ok: response.ok, status: response.status, statusText: response.statusText };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

const waitForService = async (name: string, url: string, attempts = 20, delayMs = 500) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await probe(url);
    if (result.ok) {
      console.log(`[proxy] ${name} reachable at ${url}`);
      return;
    }
    console.log(
      `[proxy] waiting for ${name} (${url}) attempt ${attempt}/${attempts}: ${result.statusText}`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`[proxy] ${name} not reachable at ${url} after ${attempts} attempts`);
};

const configureProxies = (): ProxyRequestHandler | null => {
  app.use(
    '/api',
    createProxyMiddleware({
      target: BACKEND_URL,
      changeOrigin: true,
      pathRewrite: (path) => (path.startsWith('/api') ? path : `/api${path}`)
    })
  );

  if (staticDirExists) {
    console.log(`[proxy] serving frontend assets from ${staticDir}`);
    app.use(express.static(staticDir));

    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.sendFile(path.join(staticDir, 'index.html'));
    });

    return null;
  } else {
    console.log(`[proxy] proxying frontend requests to ${FRONTEND_URL}`);
    const frontendProxy = createProxyMiddleware({
      target: FRONTEND_URL,
      changeOrigin: true,
      ws: true
    });

    app.use('/', frontendProxy);

    return frontendProxy;
  }
};

app.get('/health', async (_req: Request, res: Response) => {
  const backendHealthUrl = new URL('/health', BACKEND_URL).toString();
  const frontendHealthUrl = staticDirExists
    ? null
    : new URL('/', FRONTEND_URL).toString();

  const backend = await probe(backendHealthUrl);
  const frontend = frontendHealthUrl ? await probe(frontendHealthUrl) : null;

  const overallStatus =
    backend.ok && (frontend?.ok ?? true) ? 'ok' : 'degraded';

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      backend: {
        url: backendHealthUrl,
        status: backend.status,
        ok: backend.ok,
        statusText: backend.statusText
      },
      frontend: frontend
        ? {
            url: frontendHealthUrl,
            status: frontend.status,
            ok: frontend.ok,
            statusText: frontend.statusText
          }
        : {
            url: staticDir,
            status: staticDirExists ? 200 : 500,
            ok: staticDirExists,
            statusText: staticDirExists
              ? 'static assets available'
              : 'static assets missing'
          }
    }
  });
});

const startServer = async () => {
  if (staticDirExists) {
    const indexPath = path.join(staticDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      console.warn(`[proxy] static directory ${staticDir} missing index.html`);
    }
  } else {
    await waitForService('frontend', FRONTEND_URL);
  }

  await waitForService('backend', new URL('/health', BACKEND_URL).toString());
  const frontendProxy = configureProxies();

  let currentPort = START_PORT;
  for (let attempts = 0; attempts < MAX_PORT_SEARCH; attempts += 1) {
    try {
      const server: Server = await new Promise((resolve, reject) => {
        const listener = app.listen(currentPort, () => resolve(listener));
        listener.on('error', (error: NodeJS.ErrnoException) => {
          listener.close();
          reject(error);
        });
      });

      console.log(`[proxy] listening on port ${currentPort}`);

      if (frontendProxy) {
        server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
          const requestUrl = req.url ?? '';
          if (requestUrl.startsWith('/api')) {
            return;
          }

          // Ensure Vite dev server receives HMR websocket traffic when going through the proxy.
          frontendProxy.upgrade(req, socket, head);
        });
      }

      const handleShutdown = (signal: NodeJS.Signals) => {
        console.log(`[proxy] received ${signal}, shutting down`);
        server.close(() => process.exit(0));
      };

      process.on('SIGINT', handleShutdown);
      process.on('SIGTERM', handleShutdown);

      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        console.warn(`[proxy] port ${currentPort} in use, trying ${currentPort + 1}`);
        currentPort += 1;
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `[proxy] unable to find available port after trying ${MAX_PORT_SEARCH} options`
  );
};

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
