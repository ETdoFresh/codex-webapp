import type { Application } from "express";
import express from "express";
import healthRoutes from "./routes/healthRoutes";
import messageRoutes from "./routes/messageRoutes";
import workspaceRoutes from "./routes/workspaceRoutes";

export function registerBackend(app: Application): void {
  app.use(express.json({ limit: "10mb" }));

  // Register routes
  app.use(healthRoutes);
  app.use("/api", messageRoutes);
  app.use("/api", workspaceRoutes);

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
