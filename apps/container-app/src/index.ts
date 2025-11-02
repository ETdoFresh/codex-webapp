import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import express from "express";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { initializeMainAppClient, shutdownMainAppClient } from "./backend/services/mainAppClient";

const DEFAULT_PORT = 3001;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "..");
const frontendRoot = path.resolve(dirname, "frontend");
const clientDistPath = path.resolve(repoRoot, "dist/client");
const indexHtmlPath = path.resolve(frontendRoot, "index.html");
const isProduction = process.env.NODE_ENV === "production";

async function registerFrontendMiddleware(app: express.Application): Promise<ViteDevServer | null> {
  if (isProduction) {
    // Serve static files in production
    console.log(`[container-app] serving static frontend from ${clientDistPath}`);
    app.use(express.static(clientDistPath));

    app.use("*", async (req, res, next) => {
      if (req.originalUrl?.startsWith("/api") || req.originalUrl?.startsWith("/health")) {
        next();
        return;
      }

      try {
        const indexPath = path.resolve(clientDistPath, "index.html");
        const html = await fs.readFile(indexPath, "utf-8");
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        next(error);
      }
    });

    return null;
  }

  // Development mode with Vite
  console.log("[container-app] starting Vite dev server");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: frontendRoot,
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    if (req.originalUrl?.startsWith("/api") || req.originalUrl?.startsWith("/health")) {
      next();
      return;
    }

    try {
      const template = await fs.readFile(indexHtmlPath, "utf-8");
      const transformed = await vite.transformIndexHtml(req.originalUrl ?? "/", template);
      res.status(200).set({ "Content-Type": "text/html" }).end(transformed);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });

  return vite;
}

async function start() {
  const app = express();
  app.disable("x-powered-by");

  // Initialize connection to main app
  console.log("[container-app] Initializing main app client");
  initializeMainAppClient();

  // Register backend routes
  const { default: registerBackend } = await import("./backend/index.js");
  registerBackend(app);

  // Register frontend
  const vite = await registerFrontendMiddleware(app);

  // Error handler
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[container-app] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "InternalServerError" });
    }
  });

  const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  const httpServer = createHttpServer(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, resolve);
  });

  if (vite) {
    vite.httpServer = httpServer;
  }

  console.log(`[container-app] listening on http://localhost:${port}`);
  console.log(`[container-app] SESSION_ID: ${process.env.SESSION_ID}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[container-app] received ${signal}, shutting down`);

    // Shutdown main app client
    shutdownMainAppClient();

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    if (vite) {
      await vite.close();
    }

    process.exit(0);
  };

  const handleError = (error: unknown) => {
    console.error("[container-app] fatal error", error);
    process.exit(1);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", handleError);
  process.on("unhandledRejection", handleError);
}

start().catch((error) => {
  console.error("[container-app] failed to start", error);
  process.exit(1);
});
