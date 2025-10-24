import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type IWorkspace from "./interfaces/IWorkspace";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../..");

export const DEFAULT_WORKSPACE_ROOT = path.join(projectRoot, "workspaces");

type SessionWorkspaceRecord = {
  path: string;
  managed: boolean;
};

const normalizePath = (candidate: string): string => path.resolve(candidate);

class WorkspaceManager implements IWorkspace {
  private readonly defaultRoot: string;
  private readonly sessions: Map<string, SessionWorkspaceRecord>;

  constructor(defaultRoot: string) {
    this.defaultRoot = normalizePath(defaultRoot);
    this.sessions = new Map();
    fs.mkdirSync(this.defaultRoot, { recursive: true });
  }

  getDefaultWorkspacePath(sessionId: string): string {
    return normalizePath(path.join(this.defaultRoot, sessionId));
  }

  private getManagedStatus(sessionId: string, workspacePath: string): boolean {
    return normalizePath(workspacePath) === this.getDefaultWorkspacePath(sessionId);
  }

  registerSessionWorkspace(
    sessionId: string,
    workspacePath: string | null,
  ): string {
    const resolved = workspacePath && workspacePath.trim().length > 0
      ? normalizePath(workspacePath)
      : this.getDefaultWorkspacePath(sessionId);

    const managed = this.getManagedStatus(sessionId, resolved);
    fs.mkdirSync(resolved, { recursive: true });
    this.sessions.set(sessionId, { path: resolved, managed });
    return resolved;
  }

  getWorkspaceDirectory(sessionId: string): string {
    const record = this.sessions.get(sessionId);
    if (record) {
      return record.path;
    }
    return this.registerSessionWorkspace(sessionId, null);
  }

  ensureWorkspaceDirectory(sessionId: string): string {
    const directory = this.getWorkspaceDirectory(sessionId);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  setSessionWorkspacePath(sessionId: string, workspacePath: string): string {
    const resolved = normalizePath(workspacePath);
    const managed = this.getManagedStatus(sessionId, resolved);
    const previous = this.sessions.get(sessionId);

    fs.mkdirSync(resolved, { recursive: true });
    this.sessions.set(sessionId, { path: resolved, managed });

    if (previous && previous.managed && previous.path !== resolved) {
      try {
        fs.rmSync(previous.path, { recursive: true, force: true });
      } catch (error) {
        console.warn(
          `[codex-webapp] failed to remove managed workspace directory ${previous.path}:`,
          error,
        );
      }
    }

    return resolved;
  }

  removeWorkspaceDirectory(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }

    if (record.managed) {
      try {
        fs.rmSync(record.path, { recursive: true, force: true });
      } catch (error) {
        console.warn(
          `[codex-webapp] failed to remove managed workspace directory ${record.path}:`,
          error,
        );
      }
    }

    this.sessions.delete(sessionId);
  }

  getSessionAttachmentsDirectory(sessionId: string): string {
    const workspaceDir = this.ensureWorkspaceDirectory(sessionId);
    const attachmentsDir = path.join(
      workspaceDir,
      ".codex",
      "attachments",
      sessionId,
    );
    fs.mkdirSync(attachmentsDir, { recursive: true });
    return attachmentsDir;
  }
}

export const workspaceManager: IWorkspace = new WorkspaceManager(
  DEFAULT_WORKSPACE_ROOT,
);

export function getDefaultWorkspacePath(sessionId: string): string {
  return workspaceManager.getDefaultWorkspacePath(sessionId);
}

export function registerSessionWorkspace(
  sessionId: string,
  workspacePath: string | null,
): string {
  return workspaceManager.registerSessionWorkspace(sessionId, workspacePath);
}

export function getWorkspaceDirectory(sessionId: string): string {
  return workspaceManager.getWorkspaceDirectory(sessionId);
}

export function ensureWorkspaceDirectory(sessionId: string): string {
  return workspaceManager.ensureWorkspaceDirectory(sessionId);
}

export function setSessionWorkspacePath(
  sessionId: string,
  workspacePath: string,
): string {
  return workspaceManager.setSessionWorkspacePath(sessionId, workspacePath);
}

export function removeWorkspaceDirectory(sessionId: string): void {
  workspaceManager.removeWorkspaceDirectory(sessionId);
}

export function getSessionAttachmentsDirectory(sessionId: string): string {
  return workspaceManager.getSessionAttachmentsDirectory(sessionId);
}

export default workspaceManager;
