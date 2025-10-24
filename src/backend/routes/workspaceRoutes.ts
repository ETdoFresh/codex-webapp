import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import asyncHandler from "../middleware/asyncHandler";
import database from "../db";
import { codexManager } from "../codexManager";
import {
  ensureWorkspaceDirectory,
  getDefaultWorkspacePath,
} from "../workspaces";
import { toSessionResponse } from "../types/api";

const router = Router();

const updateWorkspaceSchema = z.object({
  path: z
    .string({
      required_error: "Path is required.",
      invalid_type_error: "Path must be a string.",
    })
    .min(1, "Path is required."),
});

const normalizePath = (value: string): string => path.resolve(value);

const expandUserPath = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed === "~") {
    return os.homedir();
  }

  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
};

const uniquePaths = (
  ...candidates: Array<string | null | undefined>
): string[] => {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const resolved = normalizePath(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    results.push(resolved);
  }
  return results;
};

const getDriveRoots = (): string[] => {
  const drives: string[] = [];
  if (process.platform === "win32") {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        if (fs.existsSync(drive)) {
          drives.push(drive);
        }
      } catch {
        // ignore
      }
    }
  }
  return drives;
};

const getQuickAccessPaths = (
  sessionId: string,
  currentPath: string | null,
  manualPath: string | null,
): string[] => {
  const defaultPath = getDefaultWorkspacePath(sessionId);
  const cwd = process.cwd();
  const home = os.homedir();
  return uniquePaths(
    currentPath,
    manualPath,
    defaultPath,
    cwd,
    home,
    ...getDriveRoots(),
  );
};

const describeWorkspace = (sessionId: string, workspacePath: string) => {
  const defaultPath = getDefaultWorkspacePath(sessionId);
  const normalizedCurrent = normalizePath(workspacePath);
  const normalizedDefault = normalizePath(defaultPath);
  const exists = fs.existsSync(normalizedCurrent)
    ? fs.statSync(normalizedCurrent).isDirectory()
    : false;
  return {
    path: normalizedCurrent,
    defaultPath: normalizedDefault,
    isDefault: normalizedCurrent === normalizedDefault,
    exists,
  } as const;
};

router.get(
  "/api/sessions/:id/workspace",
  asyncHandler(async (req, res) => {
    const session = database.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    ensureWorkspaceDirectory(session.id);

    res.json({
      workspace: describeWorkspace(session.id, session.workspacePath),
    });
  }),
);

router.post(
  "/api/sessions/:id/workspace",
  asyncHandler(async (req, res) => {
    const session = database.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const parsed = updateWorkspaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body.",
        details: parsed.error.flatten(),
      });
      return;
    }

    const candidatePath = expandUserPath(parsed.data.path);
    const resolvedCandidate = normalizePath(candidatePath);

    if (fs.existsSync(resolvedCandidate)) {
      const stats = fs.statSync(resolvedCandidate);
      if (!stats.isDirectory()) {
        res.status(400).json({ error: "Workspace path must be a directory." });
        return;
      }
    }

    let updated;
    try {
      updated = database.updateSessionWorkspacePath(
        session.id,
        resolvedCandidate,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update workspace path.";
      res.status(400).json({ error: message });
      return;
    }

    if (!updated) {
      res.status(500).json({ error: "Unable to update workspace path." });
      return;
    }

    codexManager.forgetSession(session.id);

    res.json({
      workspace: describeWorkspace(updated.id, updated.workspacePath),
      session: toSessionResponse(updated),
    });
  }),
);

const MAX_DIRECTORY_ENTRIES = 200;

const toDirectoryEntries = (
  directory: string,
): {
  entries: Array<{ name: string; path: string }>;
  truncated: boolean;
} => {
  try {
    const dirents = fs.readdirSync(directory, { withFileTypes: true });
    const directories = dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );

    const truncated = directories.length > MAX_DIRECTORY_ENTRIES;
    return {
      entries: truncated
        ? directories.slice(0, MAX_DIRECTORY_ENTRIES)
        : directories,
      truncated,
    };
  } catch (error) {
    console.warn(
      `[codex-webapp] failed to read directory ${directory}:`,
      error instanceof Error ? error.message : error,
    );
    return { entries: [], truncated: false };
  }
};

router.get(
  "/api/sessions/:id/workspace/browse",
  asyncHandler(async (req, res) => {
    const session = database.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    ensureWorkspaceDirectory(session.id);

    const rawPath = typeof req.query.path === "string" ? req.query.path : "";
    const expanded = rawPath ? expandUserPath(rawPath) : session.workspacePath;
    const targetPath = normalizePath(expanded);

    let exists = false;
    let isDirectory = false;
    let errorMessage: string | null = null;

    try {
      const stats = fs.statSync(targetPath);
      exists = true;
      isDirectory = stats.isDirectory();
      if (!isDirectory) {
        errorMessage = "Path exists but is not a directory.";
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err && err.code === "ENOENT") {
        exists = false;
      } else if (err && err.code === "EACCES") {
        errorMessage = "Permission denied when accessing the requested path.";
      } else {
        errorMessage =
          error instanceof Error
            ? error.message
            : "Unable to access the requested path.";
      }
    }

    let entries: Array<{ name: string; path: string }> = [];
    let entriesTruncated = false;
    if (exists && isDirectory) {
      const result = toDirectoryEntries(targetPath);
      entries = result.entries;
      entriesTruncated = result.truncated;
    }

    const parentPath = path.resolve(targetPath, "..");
    res.json({
      targetPath,
      exists,
      isDirectory,
      parentPath: targetPath === parentPath ? null : parentPath,
      canCreate: !exists,
      entries,
      entriesTruncated,
      quickAccess: getQuickAccessPaths(
        session.id,
        session.workspacePath,
        rawPath || null,
      ),
      error: errorMessage,
    });
  }),
);

export default router;
