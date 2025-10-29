import { Router } from "express";
import { z } from "zod";
import database from "../db";
import asyncHandler from "../middleware/asyncHandler";
import { requireAdmin } from "../middleware/auth";
import {
  findUserByUsername,
  hashPassword,
  listUsers as listAllUsers,
  validatePasswordStrength,
} from "../services/authService";

const router = Router();

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  isAdmin: z.boolean().default(false),
});

const updateUserSchema = z.object({
  password: z.string().min(8).max(200).optional(),
  isAdmin: z.boolean().optional(),
});

const toPublicUser = (user: {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}) => ({
  id: user.id,
  username: user.username,
  isAdmin: user.isAdmin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

function ensureAnotherAdminExists(excludeUserId?: string): boolean {
  return listAllUsers().some((user) => user.isAdmin && user.id !== excludeUserId);
}

router.use(requireAdmin);

router.get(
  "/api/users",
  asyncHandler(async (_req, res) => {
    const users = listAllUsers().map(toPublicUser);
    res.json({ users });
  }),
);

router.post(
  "/api/users",
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "InvalidRequest" });
      return;
    }

    const { username, password, isAdmin } = parsed.data;

    if (findUserByUsername(username)) {
      res.status(409).json({ error: "UserExists" });
      return;
    }

    try {
      validatePasswordStrength(password);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "WeakPassword",
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = database.createUser({ username, passwordHash, isAdmin });

    res.status(201).json({ user: toPublicUser(user) });
  }),
);

router.get(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    res.json({ user: toPublicUser(user) });
  }),
);

router.put(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "InvalidRequest" });
      return;
    }

    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    const updates: { passwordHash?: string; isAdmin?: boolean } = {};

    if (parsed.data.password) {
      try {
        validatePasswordStrength(parsed.data.password);
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : "WeakPassword",
        });
        return;
      }
      updates.passwordHash = await hashPassword(parsed.data.password);
    }

    if (parsed.data.isAdmin !== undefined) {
      if (!parsed.data.isAdmin && !ensureAnotherAdminExists(req.params.id)) {
        res.status(400).json({ error: "LastAdmin" });
        return;
      }
      updates.isAdmin = parsed.data.isAdmin;
    }

    const updated = database.updateUser(req.params.id, updates);
    if (!updated) {
      res.status(500).json({ error: "UpdateFailed" });
      return;
    }

    res.json({ user: toPublicUser(updated) });
  }),
);

router.delete(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    if (user.isAdmin && !ensureAnotherAdminExists(req.params.id)) {
      res.status(400).json({ error: "LastAdmin" });
      return;
    }

    const deleted = database.deleteUser(user.id);
    if (!deleted) {
      res.status(500).json({ error: "DeleteFailed" });
      return;
    }

    res.status(204).end();
  }),
);

export default router;
