import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type IWorkspace from './interfaces/IWorkspace';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '../..');

const defaultWorkspaceRoot = path.join(projectRoot, 'workspaces');
const workspaceRoot =
  process.env.CODEX_WORKSPACES_ROOT && process.env.CODEX_WORKSPACES_ROOT.trim() !== ''
    ? path.resolve(process.env.CODEX_WORKSPACES_ROOT)
    : defaultWorkspaceRoot;

class WorkspaceManager implements IWorkspace {
  constructor(private readonly root: string) {
    fs.mkdirSync(this.root, { recursive: true });
  }

  getWorkspaceRoot(): string {
    return this.root;
  }

  getWorkspaceDirectory(sessionId: string): string {
    return path.join(this.root, sessionId);
  }

  ensureWorkspaceDirectory(sessionId: string): string {
    const directory = this.getWorkspaceDirectory(sessionId);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  removeWorkspaceDirectory(sessionId: string): void {
    const directory = this.getWorkspaceDirectory(sessionId);
    if (fs.existsSync(directory)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

export const workspaceManager: IWorkspace = new WorkspaceManager(workspaceRoot);

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

export default workspaceManager;
