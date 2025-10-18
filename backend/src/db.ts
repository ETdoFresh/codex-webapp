import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import type { ThreadItem } from '@openai/codex-sdk';
import {
  ensureWorkspaceDirectory,
  removeWorkspaceDirectory,
  getWorkspaceRoot
} from './workspaces';

export type SessionRecord = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
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

type RunItemRow = {
  id: string;
  messageId: string;
  sessionId: string;
  idx: number;
  payload: string;
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

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const defaultDataDir = path.join(projectRoot, 'var');
const dataDir = process.env.BACKEND_DATA_DIR
  ? path.resolve(process.env.BACKEND_DATA_DIR)
  : defaultDataDir;

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(getWorkspaceRoot(), { recursive: true });

const databasePath = path.join(dataDir, 'chat.db');
const db = new Database(databasePath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const migrations: string[] = [
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    codex_thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`,
  `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
    ON messages(session_id, created_at)
`,
  `
  CREATE TABLE IF NOT EXISTS message_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_message_attachments_message
    ON message_attachments(message_id)
`,
  `
  CREATE INDEX IF NOT EXISTS idx_message_attachments_session
    ON message_attachments(session_id)
`,
  `
  CREATE TABLE IF NOT EXISTS message_run_items (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_message_run_items_message
    ON message_run_items(message_id, idx)
`,
  `
  CREATE INDEX IF NOT EXISTS idx_message_run_items_session
    ON message_run_items(session_id)
`
];

db.transaction(() => {
  for (const migration of migrations) {
    db.prepare(migration).run();
  }
})();

const insertSessionStmt = db.prepare<{
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}>(
  `
  INSERT INTO sessions (id, title, codex_thread_id, created_at, updated_at)
  VALUES (@id, @title, @codexThreadId, @createdAt, @updatedAt)
`
);

const listSessionsStmt = db.prepare<[], SessionRecord>(`
  SELECT id, title, codex_thread_id as codexThreadId, created_at as createdAt, updated_at as updatedAt
  FROM sessions
  ORDER BY updated_at DESC
`);

const getSessionStmt = db.prepare<{ id: string }, SessionRecord>(`
  SELECT id, title, codex_thread_id as codexThreadId, created_at as createdAt, updated_at as updatedAt
  FROM sessions
  WHERE id = @id
`);

const updateSessionTitleStmt = db.prepare<{
  id: string;
  title: string;
  updatedAt: string;
}>(`
  UPDATE sessions
  SET title = @title,
      updated_at = @updatedAt
  WHERE id = @id
`);

const updateSessionThreadStmt = db.prepare<{
  id: string;
  codexThreadId: string;
  updatedAt: string;
}>(`
  UPDATE sessions
  SET codex_thread_id = @codexThreadId,
      updated_at = @updatedAt
  WHERE id = @id
`);

const deleteSessionStmt = db.prepare<{
  id: string;
}>(`
  DELETE FROM sessions WHERE id = @id
`);

const insertMessageStmt = db.prepare<{
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}>(`
  INSERT INTO messages (id, session_id, role, content, created_at)
  VALUES (@id, @sessionId, @role, @content, @createdAt)
`);

const insertAttachmentStmt = db.prepare<{
  id: string;
  messageId: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  size: number;
  relativePath: string;
  createdAt: string;
}>(`
  INSERT INTO message_attachments (
    id,
    message_id,
    session_id,
    filename,
    mime_type,
    size,
    relative_path,
    created_at
  )
  VALUES (
    @id,
    @messageId,
    @sessionId,
    @filename,
    @mimeType,
    @size,
    @relativePath,
    @createdAt
  )
`);

const insertRunItemStmt = db.prepare<{
  id: string;
  messageId: string;
  sessionId: string;
  idx: number;
  payload: string;
  createdAt: string;
}>(`
  INSERT INTO message_run_items (
    id,
    message_id,
    session_id,
    idx,
    payload,
    created_at
  )
  VALUES (
    @id,
    @messageId,
    @sessionId,
    @idx,
    @payload,
    @createdAt
  )
`);

const listAttachmentsForMessageStmt = db.prepare<{
  messageId: string;
}, AttachmentRecord>(`
  SELECT
    id,
    message_id as messageId,
    session_id as sessionId,
    filename,
    mime_type as mimeType,
    size,
    relative_path as relativePath,
    created_at as createdAt
  FROM message_attachments
  WHERE message_id = @messageId
  ORDER BY created_at ASC
`);

const listRunItemsForMessageStmt = db.prepare<{
  messageId: string;
}, RunItemRow>(`
  SELECT
    id,
    message_id as messageId,
    session_id as sessionId,
    idx,
    payload,
    created_at as createdAt
  FROM message_run_items
  WHERE message_id = @messageId
  ORDER BY idx ASC
`);

const getAttachmentStmt = db.prepare<{
  id: string;
}, AttachmentRecord>(`
  SELECT
    id,
    message_id as messageId,
    session_id as sessionId,
    filename,
    mime_type as mimeType,
    size,
    relative_path as relativePath,
    created_at as createdAt
  FROM message_attachments
  WHERE id = @id
`);

const touchSessionStmt = db.prepare<{
  id: string;
  updatedAt: string;
}>(`
  UPDATE sessions
  SET updated_at = @updatedAt
  WHERE id = @id
`);

const listMessagesStmt = db.prepare<{ sessionId: string }, MessageRecord>(`
  SELECT id, session_id as sessionId, role, content, created_at as createdAt
  FROM messages
  WHERE session_id = @sessionId
  ORDER BY created_at ASC
`);

export function createSession(title: string): SessionRecord {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id: uuid(),
    title,
    codexThreadId: null,
    createdAt: now,
    updatedAt: now
  };

  insertSessionStmt.run({
    id: record.id,
    title: record.title,
    codexThreadId: record.codexThreadId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });

  ensureWorkspaceDirectory(record.id);

  return record;
}

export function listSessions(): SessionRecord[] {
  return listSessionsStmt.all() as SessionRecord[];
}

export function getSession(id: string): SessionRecord | null {
  return getSessionStmt.get({ id }) ?? null;
}

export function updateSessionTitle(id: string, title: string): SessionRecord | null {
  const existing = getSession(id);
  if (!existing) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  updateSessionTitleStmt.run({ id, title, updatedAt });
  return { ...existing, title, updatedAt };
}

export function updateSessionThreadId(
  id: string,
  codexThreadId: string
): SessionRecord | null {
  const existing = getSession(id);
  if (!existing) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  updateSessionThreadStmt.run({ id, codexThreadId, updatedAt });
  return { ...existing, codexThreadId, updatedAt };
}

export function deleteSession(id: string): boolean {
  const result = deleteSessionStmt.run({ id });
  const deleted = result.changes > 0;
  if (deleted) {
    removeWorkspaceDirectory(id);
  }
  return deleted;
}

export function addMessage(
  sessionId: string,
  role: MessageRecord['role'],
  content: string,
  attachments: NewAttachmentInput[] = [],
  items: ThreadItem[] = []
): MessageWithAttachments {
  const createdAt = new Date().toISOString();
  const message: MessageRecord = {
    id: uuid(),
    sessionId,
    role,
    content,
    createdAt
  };

  insertMessageStmt.run({
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  });

  const savedAttachments: AttachmentRecord[] = [];
  const savedItems: ThreadItem[] = [];

  for (const attachment of attachments) {
    const record: AttachmentRecord = {
      id: uuid(),
      messageId: message.id,
      sessionId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      relativePath: attachment.relativePath,
      createdAt
    };

    insertAttachmentStmt.run({
      id: record.id,
      messageId: record.messageId,
      sessionId: record.sessionId,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
      relativePath: record.relativePath,
      createdAt: record.createdAt
    });

    savedAttachments.push(record);
  }

  items.forEach((item, index) => {
    const id = uuid();
    const payload = JSON.stringify(item);
    insertRunItemStmt.run({
      id,
      messageId: message.id,
      sessionId,
      idx: index,
      payload,
      createdAt
    });
    try {
      savedItems.push(JSON.parse(payload) as ThreadItem);
    } catch {
      // Fallback to original item if JSON parse fails unexpectedly.
      savedItems.push(item);
    }
  });

  touchSessionStmt.run({ id: sessionId, updatedAt: message.createdAt });

  return { ...message, attachments: savedAttachments, items: savedItems };
}

export function listMessages(sessionId: string): MessageWithAttachments[] {
  const baseMessages = listMessagesStmt.all({ sessionId }) as MessageRecord[];
  return baseMessages.map((message) => ({
    ...message,
    attachments: listAttachmentsForMessageStmt.all({ messageId: message.id }) ?? [],
    items:
      listRunItemsForMessageStmt
        .all({ messageId: message.id })
        .map((row) => {
          try {
            return JSON.parse(row.payload) as ThreadItem;
          } catch {
            return { type: 'unknown', value: row.payload } as ThreadItem;
          }
        }) ?? []
  }));
}

export function getDatabasePath(): string {
  return databasePath;
}

export function getAttachment(id: string): AttachmentRecord | null {
  return getAttachmentStmt.get({ id }) ?? null;
}
