import { Router } from "express";
import { z } from "zod";
import { validateSessionContext } from "../middleware/validateToken.js";
import { fetchMessagesFromMainApp, postMessageToMainApp } from "../services/mainAppClient.js";
import { runAgent } from "../services/agentRunner.js";

const router = Router();

// Apply session validation to all routes
router.use(validateSessionContext);

const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  provider: z.enum(["CodexSDK", "ClaudeCodeSDK", "DroidCLI"]),
  model: z.string(),
  reasoningEffort: z.string().optional(),
});

/**
 * GET /api/messages
 * Fetch all messages for this session from main app
 */
router.get("/messages", async (_req, res) => {
  try {
    const messages = await fetchMessagesFromMainApp();
    res.json(messages);
  } catch (error) {
    console.error("[Container] Failed to fetch messages:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch messages";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/messages
 * Send a new user message and run the agent
 */
router.post("/messages", async (req, res) => {
  try {
    const { content, provider, model, reasoningEffort } = sendMessageSchema.parse(req.body);

    // First, save the user message to main app
    await postMessageToMainApp({
      role: "user",
      content,
      attachments: [],
      items: [],
      responderProvider: null,
      responderModel: null,
      responderReasoningEffort: null,
    });

    // Immediately respond to client that message is received
    res.status(202).json({
      status: "processing",
      message: "Message received, agent is processing",
    });

    // Run agent asynchronously (don't await - let it run in background)
    runAgent({
      provider,
      model,
      userMessage: content,
      reasoningEffort,
    }).catch((error) => {
      console.error("[Container] Agent execution failed:", error);
    });
  } catch (error) {
    console.error("[Container] Failed to process message:", error);
    
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid message format",
        details: error.errors,
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to process message";
    res.status(500).json({ error: message });
  }
});

export default router;
