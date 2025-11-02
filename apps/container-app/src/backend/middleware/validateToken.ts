import type { Request, Response, NextFunction } from "express";

const SESSION_ID = process.env.SESSION_ID;
const SESSION_TOKEN = process.env.SESSION_TOKEN;

/**
 * Middleware to validate that requests come with valid session context
 * In production, this would validate JWT tokens, but since we're inside
 * a container provisioned by the main app, we just check env vars exist
 */
export function validateSessionContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!SESSION_ID || !SESSION_TOKEN) {
    res.status(500).json({
      error: "Container not properly configured (missing SESSION_ID or SESSION_TOKEN)",
    });
    return;
  }

  // Attach to request for convenience
  req.sessionContext = {
    sessionId: SESSION_ID,
    token: SESSION_TOKEN,
  };

  next();
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      sessionContext?: {
        sessionId: string;
        token: string;
      };
    }
  }
}
