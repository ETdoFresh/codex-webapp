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
  "/auth/login",
  asyncHandler(async (req, res) => {
    console.log('[AUTH] Login attempt:', req.body);
    
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      console.log('[AUTH] Failed to parse request body:', parsed.error);
      res.status(400).json({ error: "InvalidCredentials" });
      return;
    }

    if (isRateLimited(req.ip)) {
      console.log('[AUTH] Rate limited');
      res.status(429).json({ error: "TooManyAttempts" });
      return;
    }

    const { username, password, rememberMe } = parsed.data;
    console.log('[AUTH] Looking up user:', username);
    const user = findUserByUsername(username);

    if (!user) {
      console.log('[AUTH] User not found');
      await ensureDefaultAdmin();
      res.status(401).json({ error: "InvalidCredentials" });
      return;
    }

    console.log('[AUTH] User found, verifying password');
    const valid = await verifyPassword(password, user.passwordHash);
    console.log('[AUTH] Password valid:', valid);
    
    if (!valid) {
      console.log('[AUTH] Password verification failed');
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
  "/auth/logout",
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
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  }),
);

router.post(
  "/auth/password",
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

// GitHub OAuth Integration
// Initiates GitHub OAuth flow
router.get(
  "/auth/github/authorize",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const clientId = process.env.GITHUB_CLIENT_ID;

    if (!clientId) {
      return res.status(500).json({ error: "GitHub OAuth not configured" });
    }

    // Generate state parameter for CSRF protection
    const state = Buffer.from(JSON.stringify({ userId: user.id })).toString("base64url");

    const authUrl = new URL("https://github.com/login/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", process.env.GITHUB_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/auth/github/callback`);
    authUrl.searchParams.set("scope", "repo,user:email");
    authUrl.searchParams.set("state", state);

    res.json({ url: authUrl.toString() });
  }),
);

// GitHub OAuth callback
router.get(
  "/auth/github/callback",
  asyncHandler(async (req, res) => {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      return res.status(400).send("Missing authorization code");
    }

    if (!state || typeof state !== "string") {
      return res.status(400).send("Missing state parameter");
    }

    // Verify state and extract userId
    let userId: string;
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
      userId = stateData.userId;
    } catch {
      return res.status(400).send("Invalid state parameter");
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).send("GitHub OAuth not configured");
    }

    // Exchange code for access token
    try {
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: process.env.GITHUB_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/auth/github/callback`,
        }),
      });

      const tokenData = await tokenResponse.json() as {
        access_token?: string;
        token_type?: string;
        scope?: string;
        error?: string;
        error_description?: string;
      };

      if (tokenData.error || !tokenData.access_token) {
        console.error("GitHub OAuth error:", tokenData.error, tokenData.error_description);
        return res.status(400).send(`GitHub authorization failed: ${tokenData.error_description || tokenData.error}`);
      }

      // Save token to database
      try {
        database.saveGitHubOAuthToken({
          userId,
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          scope: tokenData.scope,
        });
      } catch (dbError) {
        console.error("Failed to save GitHub token to database:", dbError);
        return res.status(500).send(`Failed to save GitHub token: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
      }

      // Redirect back to frontend GitHub panel with success message
      res.redirect("/?github_connected=true#github");
    } catch (error) {
      console.error("GitHub OAuth callback error:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).send(`Failed to complete GitHub authorization: ${errorMessage}`);
    }
  }),
);

// Check GitHub connection status
router.get(
  "/auth/github/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const token = database.getGitHubOAuthToken(user.id);

    res.json({
      connected: !!token,
      hasToken: !!token,
    });
  }),
);

// Disconnect GitHub
router.delete(
  "/auth/github",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const deleted = database.deleteGitHubOAuthToken(user.id);

    res.json({ success: deleted });
  }),
);

export default router;
