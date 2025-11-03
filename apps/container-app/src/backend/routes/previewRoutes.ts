import { Router } from "express";
import http from "node:http";
import type { IncomingMessage } from "node:http";

const router = Router();

// Port where user's application runs (configurable via env)
const USER_APP_PORT = process.env.USER_APP_PORT || "3000";
const USER_APP_HOST = process.env.USER_APP_HOST || "localhost";

/**
 * Proxy all /preview requests to the user's running application
 */
router.all("/preview*", (req, res) => {
  // Extract the path after /preview
  const targetPath = req.url?.replace(/^\/preview/, "") || "/";

  const options = {
    hostname: USER_APP_HOST,
    port: USER_APP_PORT,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      // Override host header to match target
      host: `${USER_APP_HOST}:${USER_APP_PORT}`,
    },
  };

  console.log(`[Preview] Proxying ${req.method} ${req.url} -> http://${USER_APP_HOST}:${USER_APP_PORT}${targetPath}`);

  const proxyReq = http.request(options, (proxyRes: IncomingMessage) => {
    // Forward status code and headers
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

    // Pipe the response
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (error) => {
    console.error("[Preview] Proxy error:", error);

    if (!res.headersSent) {
      res.status(502).json({
        error: "BadGateway",
        message: `Failed to connect to user application on port ${USER_APP_PORT}. Make sure your app is running.`,
        details: error.message,
      });
    }
  });

  // Pipe the request body if present
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
});

export default router;
