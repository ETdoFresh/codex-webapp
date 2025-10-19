import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import database from '../db';
import { codexManager } from '../codexManager';
import asyncHandler from '../middleware/asyncHandler';
import { DEFAULT_SESSION_TITLE } from '../config/sessions';
import { handleSessionMessageRequest } from '../services/sessionMessageService';
import { getWorkspaceRoot } from '../workspaces';
import { messageToResponse, toSessionResponse } from '../types/api';

const router = Router();

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

export default router;
