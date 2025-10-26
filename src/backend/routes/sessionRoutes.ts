import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import database from '../db';
import { codexManager } from '../codexManager';
import asyncHandler from '../middleware/asyncHandler';
import { DEFAULT_SESSION_TITLE } from '../config/sessions';
import { handleSessionMessageRequest } from '../services/sessionMessageService';
import { ensureWorkspaceDirectory, getWorkspaceDirectory } from '../workspaces';
import { messageToResponse, toSessionResponse } from '../types/api';

const router = Router();

const MAX_WORKSPACE_FILE_COUNT = 2000;
const MAX_WORKSPACE_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
const IGNORED_WORKSPACE_DIRECTORIES = new Set(['.git', '.codex', 'node_modules']);

type WorkspaceFileDescriptor = {
  path: string;
  size: number;
  updatedAt: string;
};

const toPosixPath = (value: string): string => value.split(path.sep).join('/');

const normalizeWorkspaceRelativePath = (input: string): string => {
  const sanitized = input.replace(/\\/g, '/').replace(/^\//, '').trim();
  if (sanitized.length === 0) {
    throw new Error('Path is required.');
  }

  const normalized = path.posix.normalize(sanitized);
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('Path must stay within the workspace.');
  }

  return normalized;
};

const resolveWorkspacePath = (workspaceDirectory: string, relativePath: string) => {
  const normalizedRelative = normalizeWorkspaceRelativePath(relativePath);
  const absoluteCandidate = path.resolve(
    workspaceDirectory,
    normalizedRelative.split('/').join(path.sep)
  );

  const derivedRelative = path.relative(workspaceDirectory, absoluteCandidate);
  if (
    derivedRelative.startsWith('..') ||
    path.isAbsolute(derivedRelative) ||
    derivedRelative === ''
  ) {
    throw new Error('Path must remain inside the workspace.');
  }

  return {
    absolutePath: absoluteCandidate,
    relativePath: normalizedRelative
  };
};

const listWorkspaceFiles = (workspaceDirectory: string): WorkspaceFileDescriptor[] => {
  if (!fs.existsSync(workspaceDirectory)) {
    return [];
  }

  const files: WorkspaceFileDescriptor[] = [];
  const queue: string[] = [workspaceDirectory];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const absoluteEntryPath = path.join(current, entry.name);
      const relativeEntryPath = path.relative(workspaceDirectory, absoluteEntryPath);

      if (entry.isDirectory()) {
        if (IGNORED_WORKSPACE_DIRECTORIES.has(entry.name)) {
          continue;
        }
        queue.push(absoluteEntryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = fs.statSync(absoluteEntryPath);

      files.push({
        path: toPosixPath(relativeEntryPath),
        size: stats.size,
        updatedAt: stats.mtime.toISOString()
      });

      if (files.length >= MAX_WORKSPACE_FILE_COUNT) {
        return files.sort((a, b) => a.path.localeCompare(b.path));
      }
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
};

const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(120);

const optionalTitleSchema = z
  .object({
    title: titleSchema.optional()
  })
  .optional();

const updateTitleSchema = z.object({
  title: titleSchema.optional()
});

const updateTitleLockSchema = z.object({
  locked: z.boolean()
});

const autoTitleSchema = z.object({
  messages: z
    .array(z.any())
    .min(1, 'Conversation messages are required.')
    .max(400, 'Conversation is too long to summarize automatically.'),
});

const filePathQuerySchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(500)
});

const fileWriteSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(500),
  content: z.string()
});

const findSessionOr404 = (sessionId: string, res: Response) => {
  const session = database.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return session;
};

router.get(
  '/api/sessions',
  asyncHandler(async (_req, res) => {
    const sessions = database.listSessions().map(toSessionResponse);
    res.json({ sessions });
  })
);

router.post(
  '/api/sessions',
  asyncHandler(async (req, res) => {
    const body = optionalTitleSchema.parse(req.body);
    const title = body?.title ?? DEFAULT_SESSION_TITLE;

    const session = database.createSession(title);
    res.status(201).json({ session: toSessionResponse(session) });
  })
);

router.get(
  '/api/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    res.json({ session: toSessionResponse(session) });
  })
);

router.patch(
  '/api/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const body = updateTitleSchema.parse(req.body ?? {});
    if (!body.title) {
      res.json({ session: toSessionResponse(session) });
      return;
    }

    const updated = database.updateSessionTitle(session.id, body.title);
    if (!updated) {
      res.status(500).json({ error: 'Unable to update session' });
      return;
    }

    res.json({ session: toSessionResponse(updated) });
  })
);

router.post(
  '/api/sessions/:id/title/lock',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const body = updateTitleLockSchema.parse(req.body ?? {});
    const updated = database.updateSessionTitleLocked(session.id, body.locked);
    if (!updated) {
      res.status(500).json({ error: 'Unable to update session lock state' });
      return;
    }

    res.json({ session: toSessionResponse(updated) });
  })
);

router.post(
  '/api/sessions/:id/title/auto',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const body = autoTitleSchema.parse(req.body ?? {});
    const updated = await database.updateSessionTitleFromMessages(
      session.id,
      body.messages,
    );
    if (!updated) {
      res.status(500).json({ error: 'Unable to update session title' });
      return;
    }

    res.json({ session: toSessionResponse(updated) });
  })
);

router.delete(
  '/api/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const deleted = database.deleteSession(session.id);
    if (deleted) {
      codexManager.forgetSession(session.id);
    }

    res.status(204).end();
  })
);

router.get(
  '/api/sessions/:id/messages',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const messages = database.listMessages(session.id).map(messageToResponse);
    res.json({ messages });
  })
);

router.post(
  '/api/sessions/:id/messages',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    await handleSessionMessageRequest(req, res, session);
  })
);

router.get(
  '/api/sessions/:id/files',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const workspaceDirectory = ensureWorkspaceDirectory(session.id);
    const files = listWorkspaceFiles(workspaceDirectory);
    res.json({ files });
  })
);

router.get(
  '/api/sessions/:id/files/content',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const parsed = filePathQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid file path.' });
      return;
    }

    const workspaceDirectory = ensureWorkspaceDirectory(session.id);
    let resolved: { absolutePath: string; relativePath: string };
    try {
      resolved = resolveWorkspacePath(workspaceDirectory, parsed.data.path);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid file path.'
      });
      return;
    }

    if (!fs.existsSync(resolved.absolutePath)) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const stats = fs.statSync(resolved.absolutePath);
    if (!stats.isFile()) {
      res.status(400).json({ error: 'Requested path is not a file.' });
      return;
    }

    if (stats.size > MAX_WORKSPACE_FILE_SIZE_BYTES) {
      res.status(413).json({
        error: 'File exceeds size limit for editor.',
        maxBytes: MAX_WORKSPACE_FILE_SIZE_BYTES
      });
      return;
    }

    const buffer = fs.readFileSync(resolved.absolutePath);
    if (buffer.includes(0)) {
      res.status(415).json({
        error: 'File appears to be binary and cannot be displayed.'
      });
      return;
    }

    res.json({
      file: {
        path: resolved.relativePath,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
        content: buffer.toString('utf8')
      }
    });
  })
);

router.put(
  '/api/sessions/:id/files/content',
  asyncHandler(async (req, res) => {
    const session = findSessionOr404(req.params.id, res);
    if (!session) {
      return;
    }

    const parsed = fileWriteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const workspaceDirectory = ensureWorkspaceDirectory(session.id);
    let resolved: { absolutePath: string; relativePath: string };
    try {
      resolved = resolveWorkspacePath(workspaceDirectory, parsed.data.path);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid file path.'
      });
      return;
    }

    const contentBytes = Buffer.byteLength(parsed.data.content, 'utf8');
    if (contentBytes > MAX_WORKSPACE_FILE_SIZE_BYTES) {
      res.status(413).json({
        error: 'File exceeds size limit for editor.',
        maxBytes: MAX_WORKSPACE_FILE_SIZE_BYTES
      });
      return;
    }

    fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });

    try {
      fs.writeFileSync(resolved.absolutePath, parsed.data.content, 'utf8');
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? `Unable to write file: ${error.message}`
            : 'Unable to write file.'
      });
      return;
    }

    const stats = fs.statSync(resolved.absolutePath);
    if (!stats.isFile()) {
      res.status(400).json({ error: 'Requested path is not a file.' });
      return;
    }

    res.json({
      file: {
        path: resolved.relativePath,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
        content: parsed.data.content
      }
    });
  })
);

router.get(
  '/api/sessions/:sessionId/attachments/:attachmentId',
  asyncHandler(async (req, res) => {
    const { sessionId, attachmentId } = req.params;
    const session = findSessionOr404(sessionId, res);
    if (!session) {
      return;
    }

    const attachment = database.getAttachment(attachmentId);
    if (!attachment || attachment.sessionId !== sessionId) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const workspaceDirectory = getWorkspaceDirectory(sessionId);
    const absolutePath = path.resolve(workspaceDirectory, attachment.relativePath);
    const relativeToWorkspace = path.relative(workspaceDirectory, absolutePath);
    if (
      relativeToWorkspace.startsWith('..') ||
      path.isAbsolute(relativeToWorkspace)
    ) {
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

export default router;
