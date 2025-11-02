import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingAttachment } from '../types/api';
import type { NewAttachmentInput } from '../types/database';
import {
  ensureWorkspaceDirectory,
  getSessionAttachmentsDirectory,
  getWorkspaceDirectory
} from '../workspaces';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  mimeExtensionMap
} from '../config/attachments';

export const sanitizeFileName = (name: string): string => {
  const trimmed = name.trim().replace(/[/\\]/g, '_');
  return trimmed.length > 0 ? trimmed : 'image';
};

export const determineExtension = (filename: string, mimeType: string): string => {
  const ext = path.extname(filename);
  if (ext) {
    return ext.toLowerCase();
  }
  return mimeExtensionMap[mimeType] ?? '';
};

export const saveAttachmentsToWorkspace = (
  sessionId: string,
  attachments: IncomingAttachment[]
): NewAttachmentInput[] => {
  if (attachments.length === 0) {
    return [];
  }

  const workspaceDir = ensureWorkspaceDirectory(sessionId);
  const attachmentsDir = getSessionAttachmentsDirectory(sessionId);

  return attachments.map((attachment) => {
    const buffer = Buffer.from(attachment.base64, 'base64');
    if (buffer.length === 0) {
      throw new Error(`Attachment ${attachment.filename} is empty or invalid base64`);
    }

    if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`Attachment ${attachment.filename} exceeds size limit`);
    }

    const ext = determineExtension(attachment.filename, attachment.mimeType);
    const storedName = `${randomUUID()}${ext || ''}`;
    const absolutePath = path.join(attachmentsDir, storedName);
    fs.writeFileSync(absolutePath, buffer);

    const workspaceRoot = getWorkspaceDirectory(sessionId);
    const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');

    return {
      filename: sanitizeFileName(attachment.filename),
      mimeType: attachment.mimeType,
      size: buffer.length,
      relativePath
    };
  });
};
