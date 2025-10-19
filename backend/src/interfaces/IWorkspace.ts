interface IWorkspace {
  getWorkspaceRoot(): string;
  getWorkspaceDirectory(sessionId: string): string;
  ensureWorkspaceDirectory(sessionId: string): string;
  removeWorkspaceDirectory(sessionId: string): void;
}

export default IWorkspace;
