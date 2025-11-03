import type { Application } from "express";
import express from "express";
import healthRoutes from "./routes/healthRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import previewRoutes from "./routes/previewRoutes.js";

export function registerBackend(app: Application): void {
  app.use(express.json({ limit: "10mb" }));

  // Register routes
  app.use(healthRoutes);
  app.use("/api", messageRoutes);
  app.use("/api", workspaceRoutes);
  app.use(previewRoutes);

  // Error handler
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Container] Error:", error);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: "InternalServerError",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

export default registerBackend;
