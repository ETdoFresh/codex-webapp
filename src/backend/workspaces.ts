import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type IWorkspace from "./interfaces/IWorkspace";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../..");

const defaultWorkspaceRoot = path.join(projectRoot, "workspaces");
const resolveRoot = (candidate: string | null | undefined, fallback: string) => {
  if (candidate && candidate.trim() !== "") {
    return path.resolve(candidate);
  }
  return path.resolve(fallback);
};

const initialResolvedRoot = resolveRoot(
  process.env.CODEX_WORKSPACES_ROOT,
  defaultWorkspaceRoot,
);

class WorkspaceManager implements IWorkspace {
  private root: string;
  private readonly defaultRoot: string;
  private sharedRoot: boolean;

  constructor(initialRoot: string, defaultRoot: string) {
    this.defaultRoot = path.resolve(defaultRoot);
    this.root = path.resolve(initialRoot);
    this.sharedRoot = !this.isManagedRoot(this.root);
    fs.mkdirSync(this.root, { recursive: true });
    process.env.CODEX_WORKSPACES_ROOT = this.root;
  }

  private isManagedRoot(candidate: string): boolean {
    return path.resolve(candidate) === this.defaultRoot;
  }

  private updateSharedState(): void {
    this.sharedRoot = !this.isManagedRoot(this.root);
  }

  getWorkspaceRoot(): string {
    return this.root;
  }

  setWorkspaceRoot(nextRoot: string): string {
    const trimmed = nextRoot.trim();
    if (!trimmed) {
      throw new Error("Workspace root cannot be empty.");
    }

    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved)) {
      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        throw new Error("Workspace root must be a directory.");
      }
    } else {
      fs.mkdirSync(resolved, { recursive: true });
    }

    this.root = resolved;
    this.updateSharedState();
    process.env.CODEX_WORKSPACES_ROOT = resolved;
    return this.root;
  }

  getWorkspaceDirectory(sessionId: string): string {
    if (this.sharedRoot) {
      return this.root;
    }

    return path.join(this.root, sessionId);
  }

  ensureWorkspaceDirectory(sessionId: string): string {
    const directory = this.getWorkspaceDirectory(sessionId);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  removeWorkspaceDirectory(sessionId: string): void {
    if (this.sharedRoot) {
      const attachmentsDir = path.join(
        this.root,
        ".codex",
        "attachments",
        sessionId,
      );
      if (fs.existsSync(attachmentsDir)) {
        fs.rmSync(attachmentsDir, { recursive: true, force: true });
      }
      return;
    }

    const directory = this.getWorkspaceDirectory(sessionId);
    if (fs.existsSync(directory)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  getSessionAttachmentsDirectory(sessionId: string): string {
    if (this.sharedRoot) {
      const dir = path.join(this.root, ".codex", "attachments", sessionId);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    const dir = path.join(this.ensureWorkspaceDirectory(sessionId), "attachments");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  isSharedRoot(): boolean {
    return this.sharedRoot;
  }
}

export const workspaceManager: IWorkspace = new WorkspaceManager(
  initialResolvedRoot,
  defaultWorkspaceRoot,
);

export function updateWorkspaceRoot(nextRoot: string): string {
  return workspaceManager.setWorkspaceRoot(nextRoot);
}

export function getWorkspaceRoot(): string {
  return workspaceManager.getWorkspaceRoot();
}

export function getWorkspaceDirectory(sessionId: string): string {
  return workspaceManager.getWorkspaceDirectory(sessionId);
}

export function ensureWorkspaceDirectory(sessionId: string): string {
  return workspaceManager.ensureWorkspaceDirectory(sessionId);
}

export function removeWorkspaceDirectory(sessionId: string): void {
  workspaceManager.removeWorkspaceDirectory(sessionId);
}

export function getSessionAttachmentsDirectory(sessionId: string): string {
  return workspaceManager.getSessionAttachmentsDirectory(sessionId);
}

export function isSharedWorkspaceRoot(): boolean {
  return workspaceManager.isSharedRoot();
}

export default workspaceManager;

export const DEFAULT_WORKSPACE_ROOT = defaultWorkspaceRoot;
