import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  addMessage,
  createSession,
  deleteSession,
  getDatabasePath,
  getAttachment,
  getSession,
  listMessages,
  listSessions,
  updateSessionThreadId,
  updateSessionTitle,
  type MessageWithAttachments,
  type SessionRecord
} from './db';
import { codexManager } from './codexManager';
import { z } from 'zod';
import { ensureWorkspaceDirectory, getWorkspaceDirectory, getWorkspaceRoot } from './workspaces';

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per image
const MAX_ATTACHMENTS_PER_MESSAGE = 4;
const allowedImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);
const mimeExtensionMap: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg'
};

const sanitizeFileName = (name: string): string => {
  const trimmed = name.trim().replace(/[/\\]/g, '_');
  return trimmed.length > 0 ? trimmed : 'image';
};

const determineExtension = (filename: string, mimeType: string): string => {
  const ext = path.extname(filename);
  if (ext) {
    return ext.toLowerCase();
  }
  return mimeExtensionMap[mimeType] ?? '';
};

type IncomingAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
};

const saveAttachmentsToWorkspace = (
  sessionId: string,
  attachments: IncomingAttachment[]
) => {
  if (attachments.length === 0) {
    return [];
  }

  const workspaceDir = ensureWorkspaceDirectory(sessionId);
  const attachmentsDir = path.join(workspaceDir, 'attachments');
  fs.mkdirSync(attachmentsDir, { recursive: true });

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

    const relativePath = path
      .relative(getWorkspaceRoot(), absolutePath)
      .replace(/\\/g, '/');

    return {
      filename: sanitizeFileName(attachment.filename),
      mimeType: attachment.mimeType,
      size: buffer.length,
      relativePath
    };
  });
};

const DEFAULT_SESSION_TITLE = 'New Chat';
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const serviceName = process.env.SERVICE_NAME ?? 'backend';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

const asyncHandler =
  <T extends Request, U extends Response>(handler: (req: T, res: U, next: NextFunction) => Promise<void>) =>
  (req: T, res: U, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };

type SessionResponse = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
};

type AttachmentResponse = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
};

type MessageResponse = {
  id: string;
  role: MessageWithAttachments['role'];
  content: string;
  createdAt: string;
  attachments: AttachmentResponse[];
};

const toSessionResponse = (session: SessionRecord): SessionResponse => ({
  id: session.id,
  title: session.title,
  codexThreadId: session.codexThreadId,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
});

const attachmentToResponse = (attachment: MessageWithAttachments['attachments'][number]): AttachmentResponse => ({
  id: attachment.id,
  filename: attachment.filename,
  mimeType: attachment.mimeType,
  size: attachment.size,
  url: `/api/sessions/${attachment.sessionId}/attachments/${attachment.id}`,
  createdAt: attachment.createdAt
});

const messageToResponse = (message: MessageWithAttachments): MessageResponse => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt,
  attachments: message.attachments.map(attachmentToResponse)
});

app.get('/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: serviceName,
    timestamp: new Date().toISOString(),
    databasePath: path.relative(process.cwd(), getDatabasePath())
  });
});

app.get('/api/meta', (_req: Request, res: Response) => {
  const model = process.env.CODEX_MODEL ?? 'gpt-5-codex';
  const reasoningEffort =
    process.env.CODEX_REASONING_EFFORT?.toLowerCase() ?? 'medium';

  res.json({
    model,
    reasoningEffort
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.redirect(307, '/health');
});

app.get(
  '/api/sessions',
  asyncHandler(async (_req, res) => {
    const sessions = listSessions().map(toSessionResponse);
    res.json({ sessions });
  })
);

app.post(
  '/api/sessions',
  asyncHandler(async (req, res) => {
    const schema = z
      .object({
        title: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional()
      })
      .optional();

    const body = schema.parse(req.body);
    const title = body?.title ?? DEFAULT_SESSION_TITLE;

    const session = createSession(title);
    res.status(201).json({ session: toSessionResponse(session) });
  })
);

app.get(
  '/api/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ session: toSessionResponse(session) });
  })
);

app.patch(
  '/api/sessions/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      title: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
    });

    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const body = schema.parse(req.body ?? {});
    if (!body.title) {
      res.json({ session: toSessionResponse(session) });
      return;
    }

    const updated = updateSessionTitle(session.id, body.title);
    if (!updated) {
      res.status(500).json({ error: 'Unable to update session' });
      return;
    }

    res.json({ session: toSessionResponse(updated) });
  })
);

app.delete(
  '/api/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const deleted = deleteSession(session.id);
    if (deleted) {
      codexManager.forgetSession(session.id);
    }

    res.status(204).end();
  })
);

app.get(
  '/api/sessions/:id/messages',
  asyncHandler(async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages = listMessages(session.id).map(messageToResponse);
    res.json({ messages });
  })
);

app.post(
  '/api/sessions/:id/messages',
  asyncHandler(async (req, res) => {
    const attachmentSchema = z.object({
      filename: z.string().trim().min(1).max(200),
      mimeType: z.string().trim().min(1).max(120),
      size: z.number().int().min(1),
      base64: z.string().min(1)
    });

    const schema = z.object({
      content: z
        .string()
        .trim()
        .max(4000, 'Message is too long')
        .optional(),
      attachments: z.array(attachmentSchema).optional()
    });

    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const {
      content: rawContent,
      attachments: attachmentsPayload = []
    } = schema.parse(req.body ?? {});
    const content = rawContent ?? '';

    if (content.length === 0 && attachmentsPayload.length === 0) {
      res.status(400).json({
        error: 'Provide a message or at least one image attachment.'
      });
      return;
    }

    if (attachmentsPayload.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      res.status(400).json({
        error: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`
      });
      return;
    }

    for (const attachment of attachmentsPayload) {
      if (!allowedImageMimeTypes.has(attachment.mimeType)) {
        res.status(400).json({ error: `Unsupported image type: ${attachment.mimeType}` });
        return;
      }
      if (attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
        res.status(400).json({
          error: `Attachment ${attachment.filename} exceeds the ${Math.round(
            MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)
          )}MB size limit`
        });
        return;
      }
    }

    let savedAttachmentInputs: ReturnType<typeof saveAttachmentsToWorkspace>;
    try {
      savedAttachmentInputs = saveAttachmentsToWorkspace(session.id, attachmentsPayload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to process attachments';
      res.status(400).json({ error: message });
      return;
    }

    const storedContent =
      content.length > 0 ? content : attachmentsPayload.length > 0 ? '(Image attachment)' : '';
    const userMessage = addMessage(session.id, 'user', storedContent, savedAttachmentInputs);

    if (session.title === DEFAULT_SESSION_TITLE && storedContent.length > 0) {
      const inferredTitle =
        storedContent.length > 60 ? `${storedContent.slice(0, 60).trim()}…` : storedContent;
      const updated = updateSessionTitle(session.id, inferredTitle);
      if (updated) {
        session.title = updated.title;
        session.updatedAt = updated.updatedAt;
      }
    }

    try {
      let codexInput =
        content.length > 0
          ? content
          : userMessage.attachments.length > 0
          ? 'The user provided image attachments.'
          : '';
      if (userMessage.attachments.length > 0) {
        const attachmentSummary = userMessage.attachments
          .map(
            (attachment, index) =>
              `${index + 1}. ${attachment.filename} (workspace path: ${attachment.relativePath})`
          )
          .join('\n');
        codexInput += `\n\nAttachments:\n${attachmentSummary}`;
      }

      const { result, threadId } = await codexManager.runTurn(session, codexInput);

      if (threadId && session.codexThreadId !== threadId) {
        const updated = updateSessionThreadId(session.id, threadId);
        if (updated) {
          session.codexThreadId = updated.codexThreadId;
          session.updatedAt = updated.updatedAt;
        }
      }

      const assistantMessage = addMessage(
        session.id,
        'assistant',
        result.finalResponse ?? '',
        []
      );

      res.status(201).json({
        sessionId: session.id,
        threadId: threadId ?? session.codexThreadId,
        userMessage: messageToResponse(userMessage),
        assistantMessage: messageToResponse(assistantMessage),
        usage: result.usage,
        items: result.items
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Codex error';
      res.status(502).json({
        error: 'CodexError',
        message,
        userMessage: messageToResponse(userMessage)
      });
      return;
    }
  })
);

app.get(
  '/api/sessions/:sessionId/attachments/:attachmentId',
  asyncHandler(async (req, res) => {
    const { sessionId, attachmentId } = req.params;
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const attachment = getAttachment(attachmentId);
    if (!attachment || attachment.sessionId !== sessionId) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const workspaceRoot = getWorkspaceRoot();
    const absolutePath = path.resolve(workspaceRoot, attachment.relativePath);
    if (!absolutePath.startsWith(workspaceRoot)) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    if (!fs.existsSync(absolutePath)) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    res.type(attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    res.sendFile(absolutePath);
  })
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).json({
    error: 'InternalServerError'
  });
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] listening on port ${PORT}`);
});

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
shutdownSignals.forEach((signal) => {
  process.on(signal, () => {
    console.log(`[backend] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
});
