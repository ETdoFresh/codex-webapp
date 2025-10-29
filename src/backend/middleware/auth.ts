import type { NextFunction, Request, Response } from "express";
import database from "../db";
import type { LoginSessionRecord, UserRecord } from "../types/database";
import {
  getDefaultSessionTtlMs,
  pruneExpiredLoginSessions,
} from "../services/authService";

export const SESSION_COOKIE_NAME = "codex_session";

const isProduction = process.env.NODE_ENV === "production";

declare global {
  namespace Express {
    interface Request {
      user?: UserRecord;
      loginSession?: LoginSessionRecord;
    }
  }
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
};

export function setSessionCookie(
  res: Response,
  sessionId: string,
  maxAgeMs: number = getDefaultSessionTtlMs(),
): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);
}

function removeInvalidSession(sessionId: string): void {
  if (!sessionId) {
    return;
  }
  try {
    database.deleteLoginSession(sessionId);
  } catch (error) {
    console.warn("[codex-webapp] failed to delete invalid session", error);
  }
}

export function loadUserFromSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) {
    pruneExpiredLoginSessionsSafe();
    next();
    return;
  }

  const session = database.getLoginSession(sessionId);
  if (!session) {
    clearSessionCookie(res);
    pruneExpiredLoginSessionsSafe();
    next();
    return;
  }

  const now = Date.now();
  const expiresAt = Date.parse(session.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= now) {
    clearSessionCookie(res);
    removeInvalidSession(sessionId);
    pruneExpiredLoginSessionsSafe();
    next();
    return;
  }

  const user = database.getUserById(session.userId);
  if (!user) {
    clearSessionCookie(res);
    removeInvalidSession(sessionId);
    pruneExpiredLoginSessionsSafe();
    next();
    return;
  }

  req.user = user;
  req.loginSession = session;

  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || !req.loginSession) {
    res.status(401).json({ error: "NotAuthenticated" });
    return;
  }
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || !req.loginSession) {
    res.status(401).json({ error: "NotAuthenticated" });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ error: "AdminAccessRequired" });
    return;
  }

  next();
}

function pruneExpiredLoginSessionsSafe(): void {
  try {
    pruneExpiredLoginSessions();
  } catch (error) {
    console.warn("[codex-webapp] failed to prune expired login sessions", error);
  }
}
