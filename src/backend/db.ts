import Database, { type Statement } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuid } from "uuid";
import type { ThreadItem } from "@openai/codex-sdk";
import type IDatabase from "./interfaces/IDatabase";
import type IWorkspace from "./interfaces/IWorkspace";
import { workspaceManager } from "./workspaces";
import { DEFAULT_SESSION_TITLE } from "./config/sessions";
import { generateSessionTitle } from "./services/titleService";
import type {
  AttachmentRecord,
  MessageRecord,
  MessageWithAttachments,
  NewAttachmentInput,
  SessionRecord,
} from "./types/database";

type RunItemRow = {
  id: string;
  messageId: string;
  sessionId: string;
  idx: number;
  payload: string;
  createdAt: string;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../..");
const defaultDataDir = path.join(projectRoot, "var");
const dataDir = process.env.BACKEND_DATA_DIR
  ? path.resolve(process.env.BACKEND_DATA_DIR)
  : defaultDataDir;

fs.mkdirSync(dataDir, { recursive: true });

const databasePath = path.join(dataDir, "chat.db");

const normalizePath = (value: string): string => path.resolve(value);

const migrations: string[] = [
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    codex_thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    title_locked INTEGER NOT NULL DEFAULT 0
  )
`,
  `
  CREATE TABLE IF NOT EXISTS session_workspaces (
    session_id TEXT PRIMARY KEY,
    workspace_path TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
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
`,
];

class SQLiteDatabase implements IDatabase {
  private readonly db: Database.Database;
  private readonly insertSessionStmt: Statement<{
    id: string;
    title: string;
    codexThreadId: string | null;
    createdAt: string;
    updatedAt: string;
    titleLocked: number;
  }>;
  private readonly upsertSessionWorkspaceStmt: Statement<{
    sessionId: string;
    workspacePath: string;
  }>;
  private readonly listWorkspaceMappingsStmt: Statement<
    [],
    { sessionId: string; workspacePath: string }
  >;
  private readonly listSessionsStmt: Statement<[], SessionRecord>;
  private readonly getSessionStmt: Statement<{ id: string }, SessionRecord>;
  private readonly updateSessionTitleStmt: Statement<{
    id: string;
    title: string;
    updatedAt: string;
  }>;
  private readonly updateSessionThreadStmt: Statement<{
    id: string;
    codexThreadId: string | null;
    updatedAt: string;
  }>;
  private readonly updateSessionTitleLockedStmt: Statement<{
    id: string;
    locked: number;
    updatedAt: string;
  }>;
  private readonly deleteSessionStmt: Statement<{ id: string }>;
  private readonly insertMessageStmt: Statement<{
    id: string;
    sessionId: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  private readonly insertAttachmentStmt: Statement<{
    id: string;
    messageId: string;
    sessionId: string;
    filename: string;
    mimeType: string;
    size: number;
    relativePath: string;
    createdAt: string;
  }>;
  private readonly insertRunItemStmt: Statement<{
    id: string;
    messageId: string;
    sessionId: string;
    idx: number;
    payload: string;
    createdAt: string;
  }>;
  private readonly listAttachmentsForMessageStmt: Statement<
    { messageId: string },
    AttachmentRecord
  >;
  private readonly listRunItemsForMessageStmt: Statement<
    { messageId: string },
    RunItemRow
  >;
  private readonly getAttachmentStmt: Statement<
    { id: string },
    AttachmentRecord
  >;
  private readonly touchSessionStmt: Statement<{
    id: string;
    updatedAt: string;
  }>;
  private readonly listMessagesStmt: Statement<
    { sessionId: string },
    MessageRecord
  >;
  private readonly resetAllThreadsStmt: Statement;

  constructor(private readonly workspace: IWorkspace) {
    this.db = new Database(databasePath);
    this.configure();
    this.runMigrations();
    this.ensureSessionColumns();
    this.upsertSessionWorkspaceStmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_workspaces (session_id, workspace_path)
      VALUES (@sessionId, @workspacePath)
    `);
    this.listWorkspaceMappingsStmt = this.db.prepare(`
      SELECT session_id as sessionId, workspace_path as workspacePath
      FROM session_workspaces
    `);
    this.initializeWorkspaceMappings();
    this.insertSessionStmt = this.db.prepare(`
      INSERT INTO sessions (
        id,
        title,
        codex_thread_id,
        created_at,
        updated_at,
        title_locked
      )
      VALUES (
        @id,
        @title,
        @codexThreadId,
        @createdAt,
        @updatedAt,
        @titleLocked
      )
    `);
    this.listSessionsStmt = this.db.prepare(`
      SELECT
        s.id,
        s.title,
        s.codex_thread_id as codexThreadId,
        s.created_at as createdAt,
        s.updated_at as updatedAt,
        COALESCE(sw.workspace_path, '') as workspacePath,
        s.title_locked as titleLocked
      FROM sessions s
      LEFT JOIN session_workspaces sw ON sw.session_id = s.id
      ORDER BY s.updated_at DESC
    `);
    this.getSessionStmt = this.db.prepare(`
      SELECT
        s.id,
        s.title,
        s.codex_thread_id as codexThreadId,
        s.created_at as createdAt,
        s.updated_at as updatedAt,
        COALESCE(sw.workspace_path, '') as workspacePath,
        s.title_locked as titleLocked
      FROM sessions s
      LEFT JOIN session_workspaces sw ON sw.session_id = s.id
      WHERE s.id = @id
    `);
    this.updateSessionTitleStmt = this.db.prepare(`
      UPDATE sessions
      SET title = @title,
          updated_at = @updatedAt
      WHERE id = @id
    `);
    this.updateSessionThreadStmt = this.db.prepare(`
      UPDATE sessions
      SET codex_thread_id = @codexThreadId,
          updated_at = @updatedAt
      WHERE id = @id
    `);
    this.updateSessionTitleLockedStmt = this.db.prepare(`
      UPDATE sessions
      SET title_locked = @locked,
          updated_at = @updatedAt
      WHERE id = @id
    `);
    this.resetAllThreadsStmt = this.db.prepare(`
      UPDATE sessions
      SET codex_thread_id = NULL
    `);
    this.deleteSessionStmt = this.db.prepare(`
      DELETE FROM sessions WHERE id = @id
    `);
    this.insertMessageStmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (@id, @sessionId, @role, @content, @createdAt)
    `);
    this.insertAttachmentStmt = this.db.prepare(`
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
    this.insertRunItemStmt = this.db.prepare(`
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
    this.listAttachmentsForMessageStmt = this.db.prepare(`
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
    this.listRunItemsForMessageStmt = this.db.prepare(`
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
    this.getAttachmentStmt = this.db.prepare(`
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
    this.touchSessionStmt = this.db.prepare(`
      UPDATE sessions
      SET updated_at = @updatedAt
      WHERE id = @id
    `);
    this.listMessagesStmt = this.db.prepare(`
      SELECT id, session_id as sessionId, role, content, created_at as createdAt
      FROM messages
      WHERE session_id = @sessionId
      ORDER BY created_at ASC
    `);
  }

  private ensureSessionColumns(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    const hasTitleLocked = columns.some(
      (column) => column.name === "title_locked",
    );
    if (!hasTitleLocked) {
      this.db.exec(
        `ALTER TABLE sessions ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0`,
      );
    }
  }

  private initializeWorkspaceMappings(): void {
    const selectSessionsStmt = this.db.prepare(
      `SELECT id FROM sessions`,
    );
    const existingSessions = selectSessionsStmt.all() as Array<{ id: string }>;
    const mappings = new Map<string, string>();
    const mappingRows = this.listWorkspaceMappingsStmt.all() as Array<{
      sessionId: string;
      workspacePath: string;
    }>;
    for (const row of mappingRows) {
      mappings.set(row.sessionId, row.workspacePath);
    }

    for (const session of existingSessions) {
      const storedPath = mappings.get(session.id) ?? null;
      const resolved = this.workspace.registerSessionWorkspace(
        session.id,
        storedPath,
      );
      if (!storedPath || normalizePath(storedPath) !== resolved) {
        this.upsertSessionWorkspaceStmt.run({
          sessionId: session.id,
          workspacePath: resolved,
        });
      }
    }
  }

  private hydrateSessionRecord(record: SessionRecord): SessionRecord {
    record.titleLocked = Boolean(record.titleLocked);
    const storedPath =
      record.workspacePath && record.workspacePath.trim().length > 0
        ? record.workspacePath
        : null;
    const resolved = this.workspace.registerSessionWorkspace(
      record.id,
      storedPath,
    );
    if (!storedPath || normalizePath(storedPath) !== resolved) {
      this.upsertSessionWorkspaceStmt.run({
        sessionId: record.id,
        workspacePath: resolved,
      });
    }
    record.workspacePath = resolved;
    return record;
  }

  private hydrateNullableSessionRecord(
    record: SessionRecord | null,
  ): SessionRecord | null {
    if (!record) {
      return null;
    }
    return this.hydrateSessionRecord(record);
  }

  getDatabasePath(): string {
    return databasePath;
  }

  createSession(title: string): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: uuid(),
      title,
      codexThreadId: null,
      createdAt: now,
      updatedAt: now,
      workspacePath: "",
      titleLocked: false,
    };

    this.insertSessionStmt.run({
      id: record.id,
      title: record.title,
      codexThreadId: record.codexThreadId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      titleLocked: record.titleLocked ? 1 : 0,
    });

    const workspacePath = this.workspace.registerSessionWorkspace(
      record.id,
      null,
    );
    this.upsertSessionWorkspaceStmt.run({
      sessionId: record.id,
      workspacePath,
    });

    return { ...record, workspacePath };
  }

  listSessions(): SessionRecord[] {
    return this.listSessionsStmt
      .all()
      .map((record) => this.hydrateSessionRecord(record));
  }

  getSession(id: string): SessionRecord | null {
    const record = this.getSessionStmt.get({ id }) ?? null;
    return this.hydrateNullableSessionRecord(record);
  }

  updateSessionTitle(id: string, title: string): SessionRecord | null {
    const existing = this.getSession(id);
    if (!existing) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    this.updateSessionTitleStmt.run({ id, title, updatedAt });
    return { ...existing, title, updatedAt };
  }

  updateSessionTitleLocked(id: string, locked: boolean): SessionRecord | null {
    const existing = this.getSession(id);
    if (!existing) {
      return null;
    }

    if (existing.titleLocked === locked) {
      return existing;
    }

    const updatedAt = new Date().toISOString();
    this.updateSessionTitleLockedStmt.run({
      id,
      locked: locked ? 1 : 0,
      updatedAt,
    });

    return { ...existing, titleLocked: locked, updatedAt };
  }

  async updateSessionTitleFromMessages(
    id: string,
    messages: unknown[],
  ): Promise<SessionRecord | null> {
    const existing = this.getSession(id);
    if (!existing) {
      return null;
    }

    if (existing.titleLocked) {
      return existing;
    }

    const suggestion = await generateSessionTitle(existing, messages, {
      fallback: existing.title,
    });
    const normalizedSuggestion = suggestion.trim();
    if (normalizedSuggestion.length === 0) {
      return existing;
    }

    if (normalizedSuggestion === existing.title) {
      return existing;
    }

    const updatedAt = new Date().toISOString();
    this.updateSessionTitleStmt.run({
      id,
      title: normalizedSuggestion,
      updatedAt,
    });

    return { ...existing, title: normalizedSuggestion, updatedAt };
  }

  updateSessionThreadId(
    id: string,
    codexThreadId: string | null,
  ): SessionRecord | null {
    const existing = this.getSession(id);
    if (!existing) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    this.updateSessionThreadStmt.run({ id, codexThreadId, updatedAt });
    return { ...existing, codexThreadId, updatedAt };
  }

  updateSessionWorkspacePath(
    id: string,
    workspacePath: string,
  ): SessionRecord | null {
    const existing = this.getSession(id);
    if (!existing) {
      return null;
    }

    const resolved = this.workspace.setSessionWorkspacePath(id, workspacePath);
    const updatedAt = new Date().toISOString();
    this.upsertSessionWorkspaceStmt.run({
      sessionId: id,
      workspacePath: resolved,
    });
    this.updateSessionThreadStmt.run({ id, codexThreadId: null, updatedAt });

    const updated: SessionRecord = {
      ...existing,
      workspacePath: resolved,
      codexThreadId: null,
      updatedAt,
    };

    return updated;
  }

  resetAllSessionThreads(): void {
    this.resetAllThreadsStmt.run();
  }

  deleteSession(id: string): boolean {
    const result = this.deleteSessionStmt.run({ id });
    const deleted = result.changes > 0;
    if (deleted) {
      this.workspace.removeWorkspaceDirectory(id);
    }
    return deleted;
  }

  addMessage(
    sessionId: string,
    role: MessageRecord["role"],
    content: string,
    attachments: NewAttachmentInput[] = [],
    items: ThreadItem[] = [],
  ): MessageWithAttachments {
    const createdAt = new Date().toISOString();
    const message: MessageRecord = {
      id: uuid(),
      sessionId,
      role,
      content,
      createdAt,
    };

    this.insertMessageStmt.run({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
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
        createdAt,
      };

      this.insertAttachmentStmt.run({
        id: record.id,
        messageId: record.messageId,
        sessionId: record.sessionId,
        filename: record.filename,
        mimeType: record.mimeType,
        size: record.size,
        relativePath: record.relativePath,
        createdAt: record.createdAt,
      });

      savedAttachments.push(record);
    }

    items.forEach((item, index) => {
      const id = uuid();
      const payload = JSON.stringify(item);
      this.insertRunItemStmt.run({
        id,
        messageId: message.id,
        sessionId,
        idx: index,
        payload,
        createdAt,
      });
      try {
        savedItems.push(JSON.parse(payload) as ThreadItem);
      } catch {
        savedItems.push(item);
      }
    });

    this.touchSessionStmt.run({ id: sessionId, updatedAt: message.createdAt });

    return { ...message, attachments: savedAttachments, items: savedItems };
  }

  listMessages(sessionId: string): MessageWithAttachments[] {
    const baseMessages = this.listMessagesStmt.all({
      sessionId,
    }) as MessageRecord[];
    return baseMessages.map((message) => ({
      ...message,
      attachments:
        this.listAttachmentsForMessageStmt.all({ messageId: message.id }) ?? [],
      items:
        this.listRunItemsForMessageStmt
          .all({ messageId: message.id })
          .map((row) => this.deserializeRunItem(row.payload)) ?? [],
    }));
  }

  getAttachment(id: string): AttachmentRecord | null {
    return this.getAttachmentStmt.get({ id }) ?? null;
  }

  private configure(): void {
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
  }

  private runMigrations(): void {
    this.db.transaction(() => {
      for (const migration of migrations) {
        this.db.prepare(migration).run();
      }
    })();
  }

  private deserializeRunItem(payload: string): ThreadItem {
    try {
      return JSON.parse(payload) as ThreadItem;
    } catch {
      return { type: "unknown", value: payload } as ThreadItem;
    }
  }
}

export const database: IDatabase = new SQLiteDatabase(workspaceManager);

export default database;
