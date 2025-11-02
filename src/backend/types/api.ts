import type { ThreadItem } from '@openai/codex-sdk';
import type { MessageWithAttachments, SessionRecord } from './database';

export type SessionResponse = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  titleLocked: boolean;
  gitBranch?: string | null;
};

export type AttachmentResponse = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
};

export type MessageResponse = {
  id: string;
  role: MessageWithAttachments['role'];
  content: string;
  createdAt: string;
  attachments: AttachmentResponse[];
  items: ThreadItem[];
  responderProvider: string | null;
  responderModel: string | null;
  responderReasoningEffort: string | null;
};

export type IncomingAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
};

export const toSessionResponse = (session: SessionRecord): SessionResponse => ({
  id: session.id,
  title: session.title,
  codexThreadId: session.codexThreadId,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  workspacePath: session.workspacePath,
  titleLocked: session.titleLocked
});

export const attachmentToResponse = (
  attachment: MessageWithAttachments['attachments'][number]
): AttachmentResponse => ({
  id: attachment.id,
  filename: attachment.filename,
  mimeType: attachment.mimeType,
  size: attachment.size,
  url: `/api/sessions/${attachment.sessionId}/attachments/${attachment.id}`,
  createdAt: attachment.createdAt
});

export const messageToResponse = (message: MessageWithAttachments): MessageResponse => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt,
  attachments: message.attachments.map(attachmentToResponse),
  items: message.items ?? [],
  responderProvider: message.responderProvider ?? null,
  responderModel: message.responderModel ?? null,
  responderReasoningEffort: message.responderReasoningEffort ?? null
});
