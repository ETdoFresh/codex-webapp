import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import asyncHandler from "../middleware/asyncHandler";
import { codexManager } from "../codexManager";
import database from "../db";
import {
  DEFAULT_WORKSPACE_ROOT,
  ensureWorkspaceDirectory,
  getWorkspaceRoot,
  updateWorkspaceRoot,
} from "../workspaces";

const router = Router();

const updateWorkspaceRootSchema = z.object({
  path: z
    .string({
      required_error: "Path is required.",
      invalid_type_error: "Path must be a string.",
    })
    .min(1, "Path is required."),
});

const MAX_DIRECTORY_ENTRIES = 200;

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

const uniquePaths = (...paths: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
};

const getQuickAccessPaths = (): string[] => {
  const cwd = process.cwd();
  const home = os.homedir();
  const currentRoot = getWorkspaceRoot();

  const driveRoots: string[] = [];
  if (process.platform === "win32") {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        if (fs.existsSync(drive)) {
          driveRoots.push(drive);
        }
      } catch {
        // ignore inaccessible drives
      }
    }
  }

  return uniquePaths(
    currentRoot,
    DEFAULT_WORKSPACE_ROOT,
    cwd,
    home,
    ...driveRoots,
  );
};

router.get(
  "/api/workspaces/root",
  asyncHandler(async (_req, res) => {
    const root = getWorkspaceRoot();
    const exists = fs.existsSync(root) && fs.statSync(root).isDirectory();

    res.json({
      root,
      defaultRoot: DEFAULT_WORKSPACE_ROOT,
      isDefault: path.resolve(root) === path.resolve(DEFAULT_WORKSPACE_ROOT),
      exists,
    });
  }),
);

router.post(
  "/api/workspaces/root",
  asyncHandler(async (req, res) => {
    const parsed = updateWorkspaceRootSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body.",
        details: parsed.error.flatten(),
      });
      return;
    }

    const candidatePath = expandUserPath(parsed.data.path);

    let newRoot: string;
    try {
      newRoot = updateWorkspaceRoot(candidatePath);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update workspace root.";
      res.status(400).json({ error: message });
      return;
    }

    const sessions = database.listSessions();
    sessions.forEach((session) => {
      try {
        ensureWorkspaceDirectory(session.id);
      } catch (error) {
        console.warn(
          `[codex-webapp] failed to ensure workspace directory for session ${session.id}:`,
          error,
        );
      }
    });

    codexManager.clearThreadCache();

    res.json({
      root: newRoot,
      defaultRoot: DEFAULT_WORKSPACE_ROOT,
      isDefault: path.resolve(newRoot) === path.resolve(DEFAULT_WORKSPACE_ROOT),
      exists: fs.existsSync(newRoot),
    });
  }),
);

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
  "/api/workspaces/browse",
  asyncHandler(async (req, res) => {
    const rawPath = typeof req.query.path === "string" ? req.query.path : "";
    const expanded = rawPath ? expandUserPath(rawPath) : getWorkspaceRoot();
    const targetPath = path.resolve(expanded);

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

    const parentCandidate = path.dirname(targetPath);
    const parentPath =
      parentCandidate && parentCandidate !== targetPath
        ? parentCandidate
        : null;

    let parentExists = false;
    if (!exists && parentPath) {
      try {
        const stats = fs.statSync(parentPath);
        parentExists = stats.isDirectory();
      } catch {
        parentExists = false;
      }
    }

    const { entries, truncated } =
      exists && isDirectory
        ? toDirectoryEntries(targetPath)
        : { entries: [], truncated: false };

    res.json({
      targetPath,
      exists,
      isDirectory,
      parentPath,
      canCreate: !exists && parentExists,
      entries,
      entriesTruncated: truncated,
      quickAccess: getQuickAccessPaths(),
      error: errorMessage,
    });
  }),
);

export default router;
