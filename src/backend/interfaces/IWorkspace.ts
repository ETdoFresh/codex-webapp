interface IWorkspace {
  getWorkspaceRoot(): string;
  setWorkspaceRoot(root: string): string;
  getWorkspaceDirectory(sessionId: string): string;
  ensureWorkspaceDirectory(sessionId: string): string;
  removeWorkspaceDirectory(sessionId: string): void;
  getSessionAttachmentsDirectory(sessionId: string): string;
  isSharedRoot(): boolean;
}

export default IWorkspace;
