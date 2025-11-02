/**
 * Shared session types
 */

export type SessionStatus = "active" | "archived";

export type Session = {
  id: string;
  userId: string;
  title: string;
  titleLocked: boolean;
  workspacePath: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
};

export type SessionSettings = {
  sessionId: string;
  githubRepo: string | null;
  customEnvVars: string; // JSON
  dockerfilePath: string | null;
  buildSettings: string; // JSON
  gitRemoteUrl: string | null;
  gitBranch: string | null;
  autoCommit: boolean;
};

export type ContainerStatus = "creating" | "running" | "stopped" | "error";

export type Container = {
  id: string;
  sessionId: string;
  dokployAppId: string | null;
  containerUrl: string | null;
  status: ContainerStatus;
  errorMessage: string | null;
  createdAt: string;
};
