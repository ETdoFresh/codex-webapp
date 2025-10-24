import type { ThreadItem } from '@openai/codex-sdk';

export type SessionRecord = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
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
