import type { Application, NextFunction, Request, Response } from "express";
import express from "express";
import cookieParser from "cookie-parser";
import healthRoutes from "./routes/healthRoutes";
import metaRoutes from "./routes/metaRoutes";
import sessionRoutes from "./routes/sessionRoutes";
import debugRoutes from "./routes/debugRoutes";
import workspaceRoutes from "./routes/workspaceRoutes";
import deployRoutes from "./routes/deployRoutes";
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import userAuthFilesRoutes from "./routes/userAuthFilesRoutes";
import { loadUserFromSession } from "./middleware/auth";
import { ensureDefaultAdmin } from "./services/authService";

export async function registerBackend(app: Application): Promise<void> {
  await ensureDefaultAdmin();
  app.use(express.json({ limit: "20mb" }));
  app.use(cookieParser());
  app.use(loadUserFromSession);
  app.use(healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api', metaRoutes);
  app.use('/api', workspaceRoutes);
  app.use('/api', sessionRoutes);
  app.use('/api', debugRoutes);
  app.use('/api', deployRoutes);
  app.use('/api', userRoutes);
  app.use('/api', userAuthFilesRoutes);

  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(error);
      res.status(500).json({
        error: "InternalServerError",
      });
    },
  );
}

export default registerBackend;
