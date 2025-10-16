import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';

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

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const defaultDataDir = path.join(projectRoot, 'var');
const dataDir = process.env.BACKEND_DATA_DIR
  ? path.resolve(process.env.BACKEND_DATA_DIR)
  : defaultDataDir;

fs.mkdirSync(dataDir, { recursive: true });

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
  return result.changes > 0;
}

export function addMessage(
  sessionId: string,
  role: MessageRecord['role'],
  content: string
): MessageRecord {
  const message: MessageRecord = {
    id: uuid(),
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString()
  };

  insertMessageStmt.run({
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  });

  touchSessionStmt.run({ id: sessionId, updatedAt: message.createdAt });

  return message;
}

export function listMessages(sessionId: string): MessageRecord[] {
  return listMessagesStmt.all({ sessionId }) as MessageRecord[];
}

export function getDatabasePath(): string {
  return databasePath;
}
