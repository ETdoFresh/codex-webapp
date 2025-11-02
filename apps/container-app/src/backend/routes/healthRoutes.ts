import { Router } from "express";

const router = Router();

/**
 * GET /health
 * Health check endpoint for container monitoring
 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sessionId: process.env.SESSION_ID,
    timestamp: new Date().toISOString(),
  });
});

export default router;
