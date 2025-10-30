import { Router } from "express";
import database from "../db";
import asyncHandler from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import {
  createContainer,
  getContainerStatus,
  stopContainer,
  startContainer,
  deleteContainer,
  getContainerLogs,
} from "../services/containerManager";
import { exportAuthFilesAsEnvVars } from "../services/userAuthManager";
import { decryptSecret } from "../utils/secretVault";

const router = Router();
router.use(requireAuth);

/**
 * Helper to get global deploy config and API key
 */
const getDeployConfigAndKey = (): {
  config: any;
  apiKey: string;
} => {
  const deployConfigRow = database.getDeployConfig();
  if (!deployConfigRow) {
    throw new Error("Deploy configuration not found. Please configure Dokploy in admin settings.");
  }

  const apiKey = deployConfigRow.config.apiKey
    ? decryptSecret(
        deployConfigRow.config.apiKey.cipher,
        deployConfigRow.config.apiKey.iv,
        deployConfigRow.config.apiKey.tag,
      )
    : null;

  if (!apiKey) {
    throw new Error("Dokploy API key not configured.");
  }

  return { config: deployConfigRow.config, apiKey };
};

/**
 * Helper to verify session belongs to user
 */
const verifySessionOwnership = (sessionId: string, userId: string) => {
  const session = database.getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.userId !== userId) {
    throw new Error("Unauthorized");
  }
  return session;
};

// POST /api/sessions/:id/container/create
router.post(
  "/sessions/:id/container/create",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    // Verify session ownership
    verifySessionOwnership(sessionId, userId);

    // Get session settings
    const settings = database.getSessionSettings(sessionId);
    if (!settings) {
      res.status(400).json({
        error: "Session settings not found. Please provide settings when creating the session.",
      });
      return;
    }

    // Get global deploy config
    const { config, apiKey } = getDeployConfigAndKey();

    // Export auth files as env vars
    const authEnvVars = exportAuthFilesAsEnvVars(userId);

    // Create container asynchronously
    createContainer({
      sessionId,
      settings,
      userId,
      globalConfig: config,
      apiKey,
      authEnvVars,
    }).catch((error) => {
      console.error(`Failed to create container for session ${sessionId}:`, error);
    });

    res.json({ message: "Container creation initiated" });
  }),
);

// GET /api/sessions/:id/container/status
router.get(
  "/sessions/:id/container/status",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const status = await getContainerStatus(sessionId);
    if (!status) {
      res.status(404).json({ error: "Container not found" });
      return;
    }

    res.json(status);
  }),
);

// GET /api/sessions/:id/container/logs
router.get(
  "/sessions/:id/container/logs",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    const logs = await getContainerLogs(sessionId, config, apiKey);

    res.json({ logs });
  }),
);

// POST /api/sessions/:id/container/start
router.post(
  "/sessions/:id/container/start",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    await startContainer(sessionId, config, apiKey);

    res.json({ message: "Container started" });
  }),
);

// POST /api/sessions/:id/container/stop
router.post(
  "/sessions/:id/container/stop",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    await stopContainer(sessionId, config, apiKey);

    res.json({ message: "Container stopped" });
  }),
);

// DELETE /api/sessions/:id/container
router.delete(
  "/sessions/:id/container",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    await deleteContainer(sessionId, config, apiKey);

    res.status(204).end();
  }),
);

export default router;
