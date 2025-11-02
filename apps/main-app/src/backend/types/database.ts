import type { ThreadItem } from '@openai/codex-sdk';
import type { DeployConfig } from '../../shared/dokploy';

export type SessionRecord = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  titleLocked: boolean;
  userId: string | null;
};

export type MessageRecord = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: string;
  responderProvider: string | null;
  responderModel: string | null;
  responderReasoningEffort: string | null;
};

export type AttachmentRecord = {
  id: string;
  messageId: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  size: number;
  relativePath: string;
  createdAt: string;
};

export type MessageWithAttachments = MessageRecord & {
  attachments: AttachmentRecord[];
  items: ThreadItem[];
};

export type NewAttachmentInput = {
  filename: string;
  mimeType: string;
  size: number;
  relativePath: string;
};

export type DeployConfigRow = {
  id: string;
  config: DeployConfig;
  updatedAt: string;
  hasApiKey: boolean;
  apiKeyCipher?: string | null;
  apiKeyIv?: string | null;
  apiKeyTag?: string | null;
};

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LoginSessionRecord = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export type UserAuthFileRecord = {
  id: string;
  userId: string;
  provider: 'codex' | 'claude' | 'droid' | 'copilot';
  fileName: string;
  encryptedContent: string;
  encryptedIv: string | null;
  encryptedTag: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionServiceRecord = {
  id: string;
  sessionId: string;
  dokployAppId: string | null;
  serviceUrl: string | null;
  status: 'creating' | 'running' | 'stopped' | 'error';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionSettingsRecord = {
  id: string;
  sessionId: string;
  githubRepo: string | null;
  customEnvVars: string; // JSON string
  dockerfilePath: string | null;
  buildSettings: string; // JSON string
  gitRemoteUrl: string | null;
  gitBranch: string | null;
  autoCommit: boolean;
  createdAt: string;
  updatedAt: string;
};
