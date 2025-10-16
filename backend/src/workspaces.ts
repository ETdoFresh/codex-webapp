import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');

const defaultWorkspaceRoot = path.join(projectRoot, 'workspaces');
const workspaceRoot =
  process.env.CODEX_WORKSPACES_ROOT && process.env.CODEX_WORKSPACES_ROOT.trim() !== ''
    ? path.resolve(process.env.CODEX_WORKSPACES_ROOT)
    : defaultWorkspaceRoot;

fs.mkdirSync(workspaceRoot, { recursive: true });

export function getWorkspaceRoot(): string {
  return workspaceRoot;
}

export function getWorkspaceDirectory(sessionId: string): string {
  return path.join(workspaceRoot, sessionId);
}

export function ensureWorkspaceDirectory(sessionId: string): string {
  const directory = getWorkspaceDirectory(sessionId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function removeWorkspaceDirectory(sessionId: string): void {
  const directory = getWorkspaceDirectory(sessionId);
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
