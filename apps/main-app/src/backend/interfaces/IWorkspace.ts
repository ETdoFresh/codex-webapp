interface IWorkspace {
  getDefaultWorkspacePath(sessionId: string): string;
  registerSessionWorkspace(
    sessionId: string,
    workspacePath: string | null,
  ): string;
  getWorkspaceDirectory(sessionId: string): string;
  ensureWorkspaceDirectory(sessionId: string): string;
  setSessionWorkspacePath(sessionId: string, workspacePath: string): string;
  removeWorkspaceDirectory(sessionId: string): void;
  getSessionAttachmentsDirectory(sessionId: string): string;
}

export default IWorkspace;
