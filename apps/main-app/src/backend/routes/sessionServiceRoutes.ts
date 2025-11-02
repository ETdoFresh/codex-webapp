import { Router } from "express";
import database from "../db";
import asyncHandler from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import {
  createService,
  getServiceStatus,
  stopService,
  startService,
  deleteService,
  getServiceLogs,
} from "../services/serviceManager";
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
  console.log('[DEPLOY-CONFIG] Row:', deployConfigRow);

  if (!deployConfigRow) {
    throw new Error("Deploy configuration not found. Please configure Dokploy in admin settings.");
  }

  console.log('[DEPLOY-CONFIG] Has cipher?', Boolean(deployConfigRow.apiKeyCipher));
  console.log('[DEPLOY-CONFIG] Has IV?', Boolean(deployConfigRow.apiKeyIv));
  console.log('[DEPLOY-CONFIG] Has tag?', Boolean(deployConfigRow.apiKeyTag));

  let apiKey: string | null = null;

  if (deployConfigRow.apiKeyCipher) {
    // If we have IV and tag, use AES decryption
    if (deployConfigRow.apiKeyIv && deployConfigRow.apiKeyTag) {
      apiKey = decryptSecret(
        deployConfigRow.apiKeyCipher,
        deployConfigRow.apiKeyIv,
        deployConfigRow.apiKeyTag,
      );
    } else {
      // Fallback: base64 decode
      apiKey = Buffer.from(deployConfigRow.apiKeyCipher, "base64").toString("utf8");
    }
  }

  console.log('[DEPLOY-CONFIG] Decrypted API key?', Boolean(apiKey));

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

// POST /api/sessions/:id/service/create
router.post(
  "/sessions/:id/service/create",
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

    // Create service asynchronously
    createService({
      sessionId,
      settings,
      userId,
      globalConfig: config,
      apiKey,
      authEnvVars,
    }).catch((error) => {
      console.error(`Failed to create service for session ${sessionId}:`, error);
    });

    res.json({ message: "Service creation initiated" });
  }),
);

// GET /api/sessions/:id/service/status
router.get(
  "/sessions/:id/service/status",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const status = await getServiceStatus(sessionId);
    if (!status) {
      res.status(404).json({ error: "Service not found" });
      return;
    }

    res.json(status);
  }),
);

// GET /api/sessions/:id/service/logs
router.get(
  "/sessions/:id/service/logs",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    const logs = await getServiceLogs(sessionId, config, apiKey);

    res.json({ logs });
  }),
);

// POST /api/sessions/:id/service/start
router.post(
  "/sessions/:id/service/start",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    await startService(sessionId, config, apiKey);

    res.json({ message: "Service started" });
  }),
);

// POST /api/sessions/:id/service/stop
router.post(
  "/sessions/:id/service/stop",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    await stopService(sessionId, config, apiKey);

    res.json({ message: "Service stopped" });
  }),
);

// DELETE /api/sessions/:id/service
router.delete(
  "/sessions/:id/service",
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user!.id;

    verifySessionOwnership(sessionId, userId);

    const { config, apiKey } = getDeployConfigAndKey();

    await deleteService(sessionId, config, apiKey);

    res.status(204).end();
  }),
);

export default router;
