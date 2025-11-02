import { Router } from "express";
import { z } from "zod";
import database from "../db";
import asyncHandler from "../middleware/asyncHandler";
import {
  validateSessionToken,
  extractTokenFromHeader,
} from "../services/sessionTokenService";
import { messageToResponse } from "../types/api";
import type { WebhookMessagePayload } from "@codex-webapp/shared";

const router = Router();

const webhookMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  attachments: z.array(
    z.object({
      filename: z.string(),
      mimeType: z.string(),
      size: z.number(),
      relativePath: z.string(),
    }),
  ),
  items: z.array(z.any()),
  responderProvider: z.string().nullable(),
  responderModel: z.string().nullable(),
  responderReasoningEffort: z.string().nullable(),
});

/**
 * Middleware to validate container session token
 */
const validateContainerToken = asyncHandler(async (req, res, next) => {
  const token = extractTokenFromHeader(req.headers.authorization);

  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  try {
    const payload = validateSessionToken(token);
    const sessionId = req.params.sessionId;

    if (payload.sessionId !== sessionId) {
      res.status(403).json({ error: "Token does not match session" });
      return;
    }

    // Attach validated payload to request
    req.containerAuth = payload;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid token";
    res.status(401).json({ error: message });
  }
});

/**
 * POST /api/container-webhooks/:sessionId/message
 * Container posts a completed message to be stored in the database
 */
router.post(
  "/container-webhooks/:sessionId/message",
  validateContainerToken,
  asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    const payload: WebhookMessagePayload = webhookMessageSchema.parse(req.body);

    // Verify session exists and belongs to the user
    const session = database.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.userId !== req.containerAuth!.userId) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    // Store attachments if any
    const attachmentInputs = payload.attachments.map((att) => ({
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      relativePath: att.relativePath,
    }));

    // Add message to database
    const message = database.addMessage(
      sessionId,
      payload.role,
      payload.content,
      attachmentInputs,
    );

    // Update message with items and responder info
    if (payload.items.length > 0 || payload.responderProvider) {
      database.updateMessageItems(message.id, payload.items);
      
      if (payload.responderProvider) {
        database.updateMessageResponderMetadata(message.id, {
          provider: payload.responderProvider,
          model: payload.responderModel,
          reasoningEffort: payload.responderReasoningEffort,
        });
      }
    }

    // Return the created message
    const response = messageToResponse(message);
    res.status(201).json(response);
  }),
);

/**
 * GET /api/container-webhooks/:sessionId/messages
 * Container requests message history for the session
 */
router.get(
  "/container-webhooks/:sessionId/messages",
  validateContainerToken,
  asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;

    // Verify session exists and belongs to the user
    const session = database.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.userId !== req.containerAuth!.userId) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    // Get all messages for the session
    const messages = database.getMessages(sessionId);
    const response = messages.map(messageToResponse);

    res.json(response);
  }),
);

// Extend Express Request type to include containerAuth
declare global {
  namespace Express {
    interface Request {
      containerAuth?: {
        sessionId: string;
        userId: string;
      };
    }
  }
}

export default router;
