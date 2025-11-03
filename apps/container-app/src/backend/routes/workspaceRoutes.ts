import { Router } from "express";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateSessionContext } from "../middleware/validateToken.js";

const router = Router();
router.use(validateSessionContext);

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";

/**
 * GET /api/workspace/files
 * List all files in the workspace
 */
router.get("/workspace/files", async (_req, res) => {
  try {
    const files = await listWorkspaceFiles(WORKSPACE_PATH);
    res.json({ files });
  } catch (error) {
    console.error("[Container] Failed to list workspace files:", error);
    const message = error instanceof Error ? error.message : "Failed to list files";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/workspace/files/:path
 * Read a specific file from the workspace
 */
router.get("/workspace/files/*", async (req, res) => {
  try {
    const filePath = (req.params as string[])[0];
    if (!filePath) {
      res.status(400).json({ error: "File path is required" });
      return;
    }

    const absolutePath = path.resolve(WORKSPACE_PATH, filePath);
    
    // Security: ensure path is within workspace
    if (!absolutePath.startsWith(WORKSPACE_PATH)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const content = await fs.readFile(absolutePath, "utf-8");
    const stats = await fs.stat(absolutePath);

    res.json({
      path: filePath,
      content,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
  } catch (error) {
    console.error("[Container] Failed to read file:", error);
    
    if ((error as any).code === "ENOENT") {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to read file";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/workspace/files/:path
 * Write or update a file in the workspace
 */
router.put("/workspace/files/*", async (req, res) => {
  try {
    const filePath = (req.params as string[])[0];
    if (!filePath) {
      res.status(400).json({ error: "File path is required" });
      return;
    }

    const { content } = z.object({
      content: z.string(),
    }).parse(req.body);

    const absolutePath = path.resolve(WORKSPACE_PATH, filePath);
    
    // Security: ensure path is within workspace
    if (!absolutePath.startsWith(WORKSPACE_PATH)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Ensure parent directory exists
    const dirPath = path.dirname(absolutePath);
    await fs.mkdir(dirPath, { recursive: true });

    await fs.writeFile(absolutePath, content, "utf-8");
    const stats = await fs.stat(absolutePath);

    res.json({
      path: filePath,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
  } catch (error) {
    console.error("[Container] Failed to write file:", error);
    
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to write file";
    res.status(500).json({ error: message });
  }
});

/**
 * Helper to recursively list all files in workspace
 */
async function listWorkspaceFiles(rootPath: string): Promise<Array<{
  path: string;
  size: number;
  updatedAt: string;
}>> {
  const files: Array<{ path: string; size: number; updatedAt: string }> = [];
  const ignoreDirs = new Set([".git", "node_modules", ".codex"]);

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && ignoreDirs.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        const relativePath = path.relative(rootPath, fullPath);

        files.push({
          path: relativePath.replace(/\\/g, "/"),
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
        });
      }
    }
  }

  if (fsSync.existsSync(rootPath)) {
    await walk(rootPath);
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export default router;
