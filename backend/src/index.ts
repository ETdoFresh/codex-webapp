import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ThreadItem, Usage } from '@openai/codex-sdk';
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
import type { CodexThreadEvent } from './codexManager';
import { getCodexMeta, updateCodexMeta } from './settings';
import { z } from 'zod';
import { ensureWorkspaceDirectory, getWorkspaceDirectory, getWorkspaceRoot } from './workspaces';

declare global {
  // eslint-disable-next-line no-var
  var __STREAM_DEBUG_EVENTS__:
    | { sessionId: string; type: unknown }[]
    | undefined;
}

const STREAM_EVENT_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CODEX_STREAM_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

const streamDebugEvents: { sessionId: string; type: unknown }[] = [];
// Expose for manual inspection in dev.
globalThis.__STREAM_DEBUG_EVENTS__ = streamDebugEvents;

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
  items: ThreadItem[];
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
  attachments: message.attachments.map(attachmentToResponse),
  items: message.items ?? []
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
  res.json(getCodexMeta());
});

const metaUpdateSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional()
  })
  .refine((value) => value.model !== undefined || value.reasoningEffort !== undefined, {
    message: 'Provide a model or reasoningEffort to update.'
  });

app.patch('/api/meta', (req: Request, res: Response) => {
  const body = metaUpdateSchema.safeParse(req.body ?? {});
  if (!body.success) {
    const { formErrors, fieldErrors } = body.error.flatten();
    const messages = [
      ...formErrors,
      ...Object.values(fieldErrors).flat()
    ].filter((message) => message && message.length > 0);
    res.status(400).json({ error: messages.join('; ') || 'Invalid meta payload.' });
    return;
  }

  try {
    const { meta, modelChanged } = updateCodexMeta(body.data);
    if (modelChanged) {
      codexManager.clearThreadCache();
    }
    res.json(meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update Codex settings';
    res.status(400).json({ error: message });
  }
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
    // eslint-disable-next-line no-console
    console.log('[stream] handler invoked for session', req.params.id);
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

    let codexInput =
      content.length > 0
        ? content
        : userMessage.attachments.length > 0
        ? 'The user provided image attachments.'
        : '';
    if (userMessage.attachments.length > 0) {
      const attachmentSummary = userMessage.attachments
        .map((attachment, index) => {
          const workspaceRelativePath = attachment.relativePath.startsWith(`${session.id}/`)
            ? attachment.relativePath.slice(session.id.length + 1)
            : attachment.relativePath;
          const absolutePath = path.resolve(getWorkspaceRoot(), attachment.relativePath).replace(/\\/g, '/');
          return `${index + 1}. ${attachment.filename} (workspace path: ${workspaceRelativePath}; absolute path: ${absolutePath})`;
        })
        .join('\n');
      codexInput += `\n\nAttachments:\n${attachmentSummary}`;
    }

    res.status(201);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const streamDebugLogPath = path.join(getWorkspaceRoot(), '..', 'stream-debug.log');
    const appendDebugLog = (entry: unknown) => {
      try {
        const serialized = typeof entry === 'string' ? entry : JSON.stringify(entry);
        fs.appendFileSync(
          streamDebugLogPath,
          `[${new Date().toISOString()}] ${session.id} ${serialized}\n`
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[stream] failed to write debug log', error);
      }
    };

    let clientAborted = false;
    req.on('aborted', () => {
      clientAborted = true;
      appendDebugLog({ type: 'client_aborted' });
    });
    req.on('close', () => {
      if (!res.writableEnded) {
        clientAborted = true;
        appendDebugLog({ type: 'client_closed_before_finish' });
      } else {
        appendDebugLog({ type: 'client_closed_after_finish' });
      }
    });

    const writeEvent = (event: unknown) => {
      streamDebugEvents.push({ sessionId: session.id, type: (event as { type?: unknown })?.type });
      if (streamDebugEvents.length > 200) {
        streamDebugEvents.splice(0, streamDebugEvents.length - 200);
      }
      appendDebugLog(event);
      if (clientAborted || res.writableEnded) {
        return;
      }
      res.write(`${JSON.stringify(event)}\n`);
      const flush = (res as Response & { flush?: () => void }).flush;
      flush?.call(res);
    };

    const userMessagePayload = messageToResponse(userMessage);
    writeEvent({ type: 'user_message', message: userMessagePayload });

    const assistantTemporaryId = `temp-${randomUUID()}`;
    const assistantCreatedAt = new Date().toISOString();

    const itemOrder: string[] = [];
    const itemMap = new Map<string, ThreadItem>();
    const completedItems: ThreadItem[] = [];
    let assistantText = '';
    let usage: Usage | null = null;
    let streamError: Error | null = null;

    const snapshotItems = (): ThreadItem[] =>
      itemOrder
        .map((id) => itemMap.get(id))
        .filter((item): item is ThreadItem => item !== undefined);

    const sendSnapshot = () => {
      const snapshot: MessageResponse = {
        id: assistantTemporaryId,
        role: 'assistant',
        content: assistantText,
        createdAt: assistantCreatedAt,
        attachments: [],
        items: snapshotItems()
      };
      writeEvent({
        type: 'assistant_message_snapshot',
        message: snapshot
      });
    };

    sendSnapshot();

    const handleItemEvent = (item: ThreadItem) => {
      const itemId = (item as unknown as { id: string }).id;
      if (!itemOrder.includes(itemId)) {
        itemOrder.push(itemId);
      }
      itemMap.set(itemId, item);
      if ((item as { type?: unknown }).type === 'agent_message') {
        const messageText = (item as { text?: unknown }).text;
        if (typeof messageText === 'string') {
          assistantText = messageText;
        }
      }
    };

    try {
      const { events: eventStream } = await codexManager.runTurnStreamed(session, codexInput);
      const timeoutSymbol = Symbol('stream-timeout');
      const iterator = eventStream[Symbol.asyncIterator]();

      const nextEvent = async ():
        Promise<IteratorResult<CodexThreadEvent> | typeof timeoutSymbol> => {
        let timer: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<typeof timeoutSymbol>((resolve) => {
          timer = setTimeout(() => resolve(timeoutSymbol), STREAM_EVENT_TIMEOUT_MS);
        });
        const result = await Promise.race([iterator.next(), timeoutPromise]);
        if (timer) {
          clearTimeout(timer);
        }
        return result;
      };

      while (true) {
        const result = await nextEvent();
        if (result === timeoutSymbol) {
          streamError = new Error(
            `Codex stream stalled after ${STREAM_EVENT_TIMEOUT_MS}ms without new events.`
          );
          break;
        }

        if (result.done) {
          break;
        }

        const event = result.value;

        if (event.type === 'thread.started') {
          if (event.thread_id && session.codexThreadId !== event.thread_id) {
            const updated = updateSessionThreadId(session.id, event.thread_id);
            if (updated) {
              session.codexThreadId = updated.codexThreadId;
              session.updatedAt = updated.updatedAt;
            }
          }
          continue;
        }

        if (
          event.type === 'item.started' ||
          event.type === 'item.updated' ||
          event.type === 'item.completed'
        ) {
          handleItemEvent(event.item);
          if (event.type === 'item.completed') {
            completedItems.push(event.item);
          }
          sendSnapshot();
          continue;
        }

        if (event.type === 'turn.completed') {
          usage = event.usage;
          continue;
        }

        if (event.type === 'turn.failed') {
          streamError = new Error(event.error?.message ?? 'Codex turn failed');
          break;
        }

        if (event.type === 'error') {
          streamError = new Error(event.message ?? 'Codex stream error');
          break;
        }
      }
    } catch (error) {
      streamError = error instanceof Error ? error : new Error('Codex execution failed');
    }

    if (streamError) {
      writeEvent({
        type: 'error',
        message: streamError.message,
        temporaryId: assistantTemporaryId
      });
      writeEvent({ type: 'done' });
      if (!clientAborted && !res.writableEnded) {
        res.end();
      }
      return;
    }

    const assistantMessage = addMessage(session.id, 'assistant', assistantText, [], completedItems);
    const latestSession = getSession(session.id) ?? session;

    writeEvent({
      type: 'assistant_message_final',
      temporaryId: assistantTemporaryId,
      message: messageToResponse(assistantMessage),
      session: toSessionResponse(latestSession),
      usage
    });
    writeEvent({ type: 'done' });
    const endedByServer = !res.writableEnded;
    if (endedByServer) {
      res.end();
    }
    appendDebugLog({ type: 'server_closed', clientAborted, endedByServer });
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

app.get('/api/debug/stream-events', (_req, res) => {
  res.json({ events: streamDebugEvents });
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
