import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import {
  addMessage,
  createSession,
  deleteSession,
  getDatabasePath,
  getSession,
  listMessages,
  listSessions,
  updateSessionThreadId,
  updateSessionTitle,
  type MessageRecord,
  type SessionRecord
} from './db';
import { codexManager } from './codexManager';
import { z } from 'zod';

const DEFAULT_SESSION_TITLE = 'New Chat';
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const serviceName = process.env.SERVICE_NAME ?? 'backend';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

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

type MessageResponse = {
  id: string;
  role: MessageRecord['role'];
  content: string;
  createdAt: string;
};

const toSessionResponse = (session: SessionRecord): SessionResponse => ({
  id: session.id,
  title: session.title,
  codexThreadId: session.codexThreadId,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
});

const messageToResponse = (message: MessageRecord): MessageResponse => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt
});

app.get('/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: serviceName,
    timestamp: new Date().toISOString(),
    databasePath: path.relative(process.cwd(), getDatabasePath())
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
    const schema = z.object({
      content: z
        .string()
        .trim()
        .min(1, 'Message must not be empty')
        .max(4000, 'Message is too long')
    });

    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { content } = schema.parse(req.body ?? {});
    const userMessage = addMessage(session.id, 'user', content);

    if (session.title === DEFAULT_SESSION_TITLE) {
      const inferredTitle = content.length > 60 ? `${content.slice(0, 60).trim()}…` : content;
      const updated = updateSessionTitle(session.id, inferredTitle);
      if (updated) {
        session.title = updated.title;
        session.updatedAt = updated.updatedAt;
      }
    }

    try {
      const { result, threadId } = await codexManager.runTurn(session, content);

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
        result.finalResponse ?? ''
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
