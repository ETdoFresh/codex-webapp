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
  provider: 'codex' | 'claude' | 'droid';
  fileName: string;
  encryptedContent: string;
  encryptedIv: string | null;
  encryptedTag: string | null;
  createdAt: string;
  updatedAt: string;
};
