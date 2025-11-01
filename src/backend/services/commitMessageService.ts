import { execSync } from "child_process";
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
 * Gets git status and diff information from the workspace.
 */
function getGitContext(workspacePath: string): string {
  try {
    const cwd = workspacePath;

    // Check if it's a git repository
    try {
      execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    } catch {
      return 'Not a git repository';
    }

    let context = '';

    // Get status
    try {
      const status = execSync('git status --short', {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024
      });
      context += `=== Git Status ===\n${status}\n\n`;
    } catch (error) {
      context += '=== Git Status ===\nError getting status\n\n';
    }

    // Get cached diff (staged changes)
    try {
      const cachedDiff = execSync('git diff --cached', {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      });
      if (cachedDiff.trim()) {
        context += `=== Staged Changes (git diff --cached) ===\n${cachedDiff}\n\n`;
      }
    } catch (error) {
      // Might be empty or error
    }

    // Get unstaged diff
    try {
      const diff = execSync('git diff', {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      });
      if (diff.trim()) {
        context += `=== Unstaged Changes (git diff) ===\n${diff}\n\n`;
      }
    } catch (error) {
      // Might be empty or error
    }

    return context || 'No git changes detected';
  } catch (error) {
    console.error('Error getting git context:', error);
    return `Error getting git context: ${error instanceof Error ? error.message : String(error)}`;
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
    const gitContext = getGitContext(workspacePath);

    if (gitContext === 'Not a git repository') {
      console.warn('[commitMessageService] Workspace is not a git repository');
      return null;
    }

    if (gitContext === 'No git changes detected') {
      console.warn('[commitMessageService] No git changes to commit');
      return null;
    }

    // Build the prompt based on git-commit.md format
    const prompt = `Review the working tree and staged changes to craft a git commit message automatically.

${gitContext}

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
