import { Router } from "express";
import { z } from "zod";
import {
  ensureDefaultAdmin,
  findUserByUsername,
  issueLoginSession,
  pruneExpiredLoginSessions,
  revokeLoginSession,
  validatePasswordStrength,
  verifyPassword,
  hashPassword,
} from "../services/authService";
import { requireAuth, setSessionCookie, clearSessionCookie } from "../middleware/auth";
import asyncHandler from "../middleware/asyncHandler";
import database from "../db";

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(120),
  password: z.string().min(1, "Password is required").max(200),
  rememberMe: z.boolean().optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const LOGIN_RATE_LIMIT_MAX = 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const loginRateLimits = new Map<string, RateLimitEntry>();

const toPublicUser = (user: { id: string; username: string; isAdmin: boolean; createdAt: string; updatedAt: string }) => ({
  id: user.id,
  username: user.username,
  isAdmin: user.isAdmin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const getClientKey = (ip: string | undefined): string => ip ?? "unknown";

const isRateLimited = (ip: string | undefined): boolean => {
  const key = getClientKey(ip);
  const entry = loginRateLimits.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt <= now) {
    loginRateLimits.set(key, {
      count: 1,
      resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  entry.count += 1;
  if (entry.count > LOGIN_RATE_LIMIT_MAX) {
    return true;
  }

  loginRateLimits.set(key, entry);
  return false;
};

router.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "InvalidCredentials" });
      return;
    }

    if (isRateLimited(req.ip)) {
      res.status(429).json({ error: "TooManyAttempts" });
      return;
    }

    const { username, password, rememberMe } = parsed.data;
    const user = findUserByUsername(username);

    if (!user) {
      await ensureDefaultAdmin();
      res.status(401).json({ error: "InvalidCredentials" });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "InvalidCredentials" });
      return;
    }

    const ttl = rememberMe ? REMEMBER_ME_TTL_MS : undefined;
    const session = issueLoginSession(user.id, ttl);
    setSessionCookie(res, session.id, ttl ?? undefined);

    loginRateLimits.delete(getClientKey(req.ip));

    pruneExpiredLoginSessions();

    res.json({ user: toPublicUser(user) });
  }),
);

router.post(
  "/api/auth/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.loginSession) {
      revokeLoginSession(req.loginSession.id);
    }
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

router.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  }),
);

router.post(
  "/api/auth/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = passwordChangeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "InvalidRequest" });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = req.user!;
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "InvalidCurrentPassword" });
      return;
    }

    try {
      validatePasswordStrength(newPassword);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "WeakPassword",
      });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    database.updateUser(user.id, { passwordHash });

    if (req.loginSession) {
      revokeLoginSession(req.loginSession.id);
      clearSessionCookie(res);
    }

    res.status(204).end();
  }),
);

export default router;
