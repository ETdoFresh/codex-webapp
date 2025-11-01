import fs from "fs";
import path from "path";
import { codexManager } from "../codexManager";
import { claudeManager } from "../claudeManager";
import { droidCliManager } from "../droidCliManager";
import { getCodexMeta } from "../settings";
import type { SessionRecord } from "../types/database";
import { synchronizeUserAuthFiles } from "./userAuthManager";
import { getWorkspaceDirectory } from "../workspaces";

const applySessionAuthEnv = (session: SessionRecord): (() => void) => {
  if (!session.userId) {
    return () => {};
  }

  const { env } = synchronizeUserAuthFiles(session.userId);
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

/**
 * Gets workspace file list for commit message generation.
 */
function getWorkspaceContext(workspacePath: string): string {
  try {
    function getAllFiles(dirPath: string, baseDir: string = dirPath): string[] {
      const files: string[] = [];
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(baseDir, fullPath);

          if (entry.name.startsWith('.')) continue;
          if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;

          if (entry.isDirectory()) {
            files.push(...getAllFiles(fullPath, baseDir));
          } else if (entry.isFile()) {
            files.push(relativePath);
          }
        }
      } catch (error) {
        // Ignore errors
      }
      return files;
    }

    const files = getAllFiles(workspacePath);
    if (files.length === 0) {
      return 'No files in workspace';
    }

    let context = '=== Workspace Files ===\n';
    context += files.join('\n');
    context += '\n\n';

    // Sample some file contents for context (first 3 files)
    for (let i = 0; i < Math.min(3, files.length); i++) {
      const file = files[i];
      const filePath = path.join(workspacePath, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.size < 50 * 1024) { // Only read files smaller than 50KB
          const content = fs.readFileSync(filePath, 'utf-8');
          context += `=== ${file} ===\n${content.substring(0, 2000)}\n\n`;
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return context;
  } catch (error) {
    console.error('Error getting workspace context:', error);
    return `Error getting workspace context: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Generates a git commit message using the AI provider.
 * Uses the format specified in .factory/commands/git-commit.md
 */
export async function generateCommitMessage(
  session: SessionRecord,
): Promise<string | null> {
  try {
    const workspacePath = getWorkspaceDirectory(session.id);
    const workspaceContext = getWorkspaceContext(workspacePath);

    if (workspaceContext === 'No files in workspace') {
      console.warn('[commitMessageService] No files in workspace to commit');
      return null;
    }

    // Build the prompt based on git-commit.md format
    const prompt = `Review the workspace files to craft a git commit message automatically.

${workspaceContext}

Generate a commit message following these rules:
1. Start the subject with one of: Add, Allow, Enhance, Fix, Improve, Refactor, Remove, or Update
2. Use imperative mood in Title Case
3. Keep subject at or below 72 characters
4. Avoid unnecessary trailing punctuation
5. When the diff warrants extra context, add a blank line after the subject, then 2-5 bullet points
6. Each bullet should start with an imperative verb (e.g., "- Introduce...", "- Update...")
7. Keep bullets contiguous (no blank lines between them)
8. For tiny, self-explanatory commits, omit the bullet section

IMPORTANT: Return ONLY the commit message text, nothing else. Do not include explanations or markdown formatting around it.`;

    const meta = getCodexMeta();
    const manager = (() => {
      switch (meta.provider) {
        case 'ClaudeCodeSDK':
          return claudeManager;
        case 'DroidCLI':
          return droidCliManager;
        case 'CodexSDK':
        default:
          return codexManager;
      }
    })();

    const restoreEnv = applySessionAuthEnv(session);
    try {
      const message = await manager.generateTitleSuggestion(session, prompt);
      if (message && message.trim().length > 0) {
        return message.trim();
      }
      return null;
    } finally {
      restoreEnv();
    }
  } catch (error) {
    console.error(
      `[commitMessageService] Failed to generate commit message for session ${session.id}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
