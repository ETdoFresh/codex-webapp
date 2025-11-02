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
  DeployConfigRow,
  MessageRecord,
  MessageWithAttachments,
  NewAttachmentInput,
  SessionRecord,
  UserAuthFileRecord,
  UserRecord,
  LoginSessionRecord,
  SessionContainerRecord,
  SessionSettingsRecord,
} from "./types/database";
import type { DeployConfig } from "../shared/dokploy";
import {
  decryptSecret,
  encryptSecret,
} from "./utils/secretVault";

type RunItemRow = {
  id: string;
  messageId: string;
  sessionId: string;
  idx: number;
  payload: string;
  createdAt: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
  updated_at: string;
};

type LoginSessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

type UserAuthFileRow = {
  id: string;
  user_id: string;
  provider: string;
  file_name: string;
  encrypted_content: string;
  encrypted_iv: string;
  encrypted_tag: string;
  created_at: string;
  updated_at: string;
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
    responder_provider TEXT,
    responder_model TEXT,
    responder_reasoning_effort TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
    ON messages(session_id, created_at)
`,
  `
  ALTER TABLE messages ADD COLUMN responder_provider TEXT
`,
  `
  ALTER TABLE messages ADD COLUMN responder_model TEXT
`,
  `
  ALTER TABLE messages ADD COLUMN responder_reasoning_effort TEXT
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
  `
  CREATE TABLE IF NOT EXISTS deploy_configs (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    api_key_cipher TEXT,
    api_key_iv TEXT,
    api_key_tag TEXT,
    updated_at TEXT NOT NULL
  )
`,
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
`,
  `
  CREATE TABLE IF NOT EXISTS user_auth_files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    file_name TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    encrypted_iv TEXT,
    encrypted_tag TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, provider, file_name)
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_user_auth_files_user ON user_auth_files(user_id)
`,
  `
  CREATE TABLE IF NOT EXISTS login_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id)
`,
  `
  CREATE INDEX IF NOT EXISTS idx_login_sessions_expires ON login_sessions(expires_at)
`,
  `
  CREATE TABLE IF NOT EXISTS session_containers (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    dokploy_app_id TEXT,
    container_url TEXT,
    status TEXT NOT NULL CHECK(status IN ('creating', 'running', 'stopped', 'error')),
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_session_containers_session ON session_containers(session_id)
`,
  `
  CREATE INDEX IF NOT EXISTS idx_session_containers_status ON session_containers(status)
`,
  `
  CREATE TABLE IF NOT EXISTS session_settings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    github_repo TEXT,
    custom_env_vars TEXT NOT NULL DEFAULT '{}',
    dockerfile_path TEXT,
    build_settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`,
  `
  CREATE INDEX IF NOT EXISTS idx_session_settings_session ON session_settings(session_id)
`,
  // Add git_remote_url column for explicit Git repository tracking
  `
  ALTER TABLE session_settings ADD COLUMN git_remote_url TEXT
`,
  // Add git_branch column for 1:1 branch:session mapping
  `
  ALTER TABLE session_settings ADD COLUMN git_branch TEXT
`,
  // Enforce unique constraint on (git_remote_url, git_branch) to prevent duplicate sessions on same branch
  // Only applies when both columns are not null
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_session_settings_branch_unique
  ON session_settings(git_remote_url, git_branch)
  WHERE git_remote_url IS NOT NULL AND git_branch IS NOT NULL
`,
  // Add auto_commit column for automatic commit/push after each turn
  `
  ALTER TABLE session_settings ADD COLUMN auto_commit INTEGER DEFAULT 0
`,
  // GitHub OAuth tokens for Git operations
  `
  CREATE TABLE IF NOT EXISTS github_oauth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT NOT NULL DEFAULT 'bearer',
    scope TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_github_oauth_user ON github_oauth_tokens(user_id)
`
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
    userId: string | null;
  }>;
  private readonly upsertSessionWorkspaceStmt: Statement<{
    sessionId: string;
    workspacePath: string;
  }>;
  private readonly listWorkspaceMappingsStmt: Statement<
    [],
    { sessionId: string; workspacePath: string }
  >;
  private readonly listSessionsStmt: Statement<{ userId: string }, SessionRecord>;
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
    responderProvider: string | null;
    responderModel: string | null;
    responderReasoningEffort: string | null;
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
  private readonly getDeployConfigStmt: Statement<[], {
    id: string;
    config_json: string;
    api_key_cipher: string | null;
    api_key_iv: string | null;
    api_key_tag: string | null;
    updated_at: string;
  }>;
  private readonly upsertDeployConfigStmt: Statement<{
    id: string;
    configJson: string;
    apiKeyCipher: string | null;
    apiKeyIv: string | null;
    apiKeyTag: string | null;
    updatedAt: string;
  }>;
  private readonly insertUserStmt: Statement<{
    id: string;
    username: string;
    passwordHash: string;
    isAdmin: number;
    createdAt: string;
    updatedAt: string;
  }>;
  private readonly listUsersStmt: Statement<[], UserRow>;
  private readonly getUserByIdStmt: Statement<{ id: string }, UserRow>;
  private readonly getUserByUsernameStmt: Statement<{
    username: string;
  }, UserRow>;
  private readonly deleteUserStmt: Statement<{ id: string }>;
  private readonly insertLoginSessionStmt: Statement<{
    id: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
  }>;
  private readonly getLoginSessionStmt: Statement<
    { id: string },
    LoginSessionRow
  >;
  private readonly deleteLoginSessionStmt: Statement<{ id: string }>;
  private readonly deleteLoginSessionsByUserStmt: Statement<{
    userId: string;
  }>;
  private readonly deleteExpiredLoginSessionsStmt: Statement<{
    now: string;
  }>;
  private readonly upsertUserAuthFileStmt: Statement<{
    id: string;
    userId: string;
    provider: string;
    fileName: string;
    encryptedContent: string;
    encryptedIv: string | null;
    encryptedTag: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  private readonly deleteUserAuthFileStmt: Statement<{
    userId: string;
    provider: string;
    fileName: string;
  }>;
  private readonly listUserAuthFilesStmt: Statement<
    { userId: string },
    UserAuthFileRow
  >;
  private readonly getUserAuthFileStmt: Statement<
    {
      userId: string;
      provider: string;
      fileName: string;
    },
    UserAuthFileRow
  >;
  private readonly upsertSessionContainerStmt: Statement<{
    id: string;
    sessionId: string;
    dokployAppId: string | null;
    containerUrl: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  private readonly getSessionContainerStmt: Statement<
    { sessionId: string },
    {
      id: string;
      session_id: string;
      dokploy_app_id: string | null;
      container_url: string | null;
      status: string;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }
  >;
  private readonly deleteSessionContainerStmt: Statement<{ sessionId: string }>;
  private readonly upsertSessionSettingsStmt: Statement<{
    id: string;
    sessionId: string;
    githubRepo: string | null;
    customEnvVars: string;
    dockerfilePath: string | null;
    buildSettings: string;
    gitRemoteUrl: string | null;
    gitBranch: string | null;
    autoCommit: number;
    createdAt: string;
    updatedAt: string;
  }>;
  private readonly getSessionSettingsStmt: Statement<
    { sessionId: string },
    {
      id: string;
      session_id: string;
      github_repo: string | null;
      custom_env_vars: string;
      dockerfile_path: string | null;
      build_settings: string;
      git_remote_url: string | null;
      git_branch: string | null;
      auto_commit: number;
      created_at: string;
      updated_at: string;
    }
  >;

  constructor(private readonly workspace: IWorkspace) {
    this.db = new Database(databasePath);
    this.configure();
    this.runMigrations();
    this.ensureSessionColumns();
    this.ensureDeployConfigColumns();
    this.migrateSessionSettingsBranchData();
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
        title_locked,
        user_id
      )
      VALUES (
        @id,
        @title,
        @codexThreadId,
        @createdAt,
        @updatedAt,
        @titleLocked,
        @userId
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
        s.title_locked as titleLocked,
        s.user_id as userId
      FROM sessions s
      LEFT JOIN session_workspaces sw ON sw.session_id = s.id
      WHERE s.user_id = @userId
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
        s.title_locked as titleLocked,
        s.user_id as userId
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
      INSERT INTO messages (
        id,
        session_id,
        role,
        content,
        created_at,
        responder_provider,
        responder_model,
        responder_reasoning_effort
      )
      VALUES (
        @id,
        @sessionId,
        @role,
        @content,
        @createdAt,
        @responderProvider,
        @responderModel,
        @responderReasoningEffort
      )
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
      SELECT
        id,
        session_id as sessionId,
        role,
        content,
        created_at as createdAt,
        responder_provider as responderProvider,
        responder_model as responderModel,
        responder_reasoning_effort as responderReasoningEffort
      FROM messages
      WHERE session_id = @sessionId
      ORDER BY created_at ASC
    `);
    this.getDeployConfigStmt = this.db.prepare(`
      SELECT
        id,
        config_json,
        api_key_cipher,
        api_key_iv,
        api_key_tag,
        updated_at
      FROM deploy_configs
      WHERE id = 'default'
    `);
    this.upsertDeployConfigStmt = this.db.prepare(`
      INSERT INTO deploy_configs (
        id,
        config_json,
        api_key_cipher,
        api_key_iv,
        api_key_tag,
        updated_at
      ) VALUES (
        @id,
        @configJson,
        @apiKeyCipher,
        @apiKeyIv,
        @apiKeyTag,
        @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        config_json = excluded.config_json,
        api_key_cipher = COALESCE(excluded.api_key_cipher, deploy_configs.api_key_cipher),
        api_key_iv = COALESCE(excluded.api_key_iv, deploy_configs.api_key_iv),
        api_key_tag = COALESCE(excluded.api_key_tag, deploy_configs.api_key_tag),
        updated_at = excluded.updated_at
    `);
    this.insertUserStmt = this.db.prepare(`
      INSERT INTO users (
        id,
        username,
        password_hash,
        is_admin,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @username,
        @passwordHash,
        @isAdmin,
        @createdAt,
        @updatedAt
      )
    `);
    this.listUsersStmt = this.db.prepare(`
      SELECT
        id,
        username,
        password_hash,
        is_admin,
        created_at,
        updated_at
      FROM users
      ORDER BY created_at ASC
    `);
    this.getUserByIdStmt = this.db.prepare(`
      SELECT
        id,
        username,
        password_hash,
        is_admin,
        created_at,
        updated_at
      FROM users
      WHERE id = @id
    `);
    this.getUserByUsernameStmt = this.db.prepare(`
      SELECT
        id,
        username,
        password_hash,
        is_admin,
        created_at,
        updated_at
      FROM users
      WHERE username = @username
    `);
    this.deleteUserStmt = this.db.prepare(`
      DELETE FROM users
      WHERE id = @id
    `);
    this.insertLoginSessionStmt = this.db.prepare(`
      INSERT INTO login_sessions (
        id,
        user_id,
        expires_at,
        created_at
      ) VALUES (
        @id,
        @userId,
        @expiresAt,
        @createdAt
      )
    `);
    this.getLoginSessionStmt = this.db.prepare(`
      SELECT
        id,
        user_id,
        expires_at,
        created_at
      FROM login_sessions
      WHERE id = @id
    `);
    this.deleteLoginSessionStmt = this.db.prepare(`
      DELETE FROM login_sessions
      WHERE id = @id
    `);
    this.deleteLoginSessionsByUserStmt = this.db.prepare(`
      DELETE FROM login_sessions
      WHERE user_id = @userId
    `);
    this.deleteExpiredLoginSessionsStmt = this.db.prepare(`
      DELETE FROM login_sessions
      WHERE expires_at <= @now
    `);
    this.upsertUserAuthFileStmt = this.db.prepare(`
      INSERT INTO user_auth_files (
        id,
        user_id,
        provider,
        file_name,
        encrypted_content,
        encrypted_iv,
        encrypted_tag,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @userId,
        @provider,
        @fileName,
        @encryptedContent,
        @encryptedIv,
        @encryptedTag,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(user_id, provider, file_name) DO UPDATE SET
        encrypted_content = excluded.encrypted_content,
        encrypted_iv = excluded.encrypted_iv,
        encrypted_tag = excluded.encrypted_tag,
        updated_at = excluded.updated_at
    `);
    this.deleteUserAuthFileStmt = this.db.prepare(`
      DELETE FROM user_auth_files
      WHERE user_id = @userId AND provider = @provider AND file_name = @fileName
    `);
    this.listUserAuthFilesStmt = this.db.prepare(`
      SELECT
        id,
        user_id,
        provider,
        file_name,
        encrypted_content,
        encrypted_iv,
        encrypted_tag,
        created_at,
        updated_at
      FROM user_auth_files
      WHERE user_id = @userId
      ORDER BY provider ASC, file_name ASC
    `);
    this.getUserAuthFileStmt = this.db.prepare(`
      SELECT
        id,
        user_id,
        provider,
        file_name,
        encrypted_content,
        encrypted_iv,
        encrypted_tag,
        created_at,
        updated_at
      FROM user_auth_files
      WHERE user_id = @userId AND provider = @provider AND file_name = @fileName
    `);
    this.upsertSessionContainerStmt = this.db.prepare(`
      INSERT INTO session_containers (
        id,
        session_id,
        dokploy_app_id,
        container_url,
        status,
        error_message,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @sessionId,
        @dokployAppId,
        @containerUrl,
        @status,
        @errorMessage,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(session_id) DO UPDATE SET
        dokploy_app_id = @dokployAppId,
        container_url = @containerUrl,
        status = @status,
        error_message = @errorMessage,
        updated_at = @updatedAt
    `);
    this.getSessionContainerStmt = this.db.prepare(`
      SELECT
        id,
        session_id,
        dokploy_app_id,
        container_url,
        status,
        error_message,
        created_at,
        updated_at
      FROM session_containers
      WHERE session_id = @sessionId
    `);
    this.deleteSessionContainerStmt = this.db.prepare(`
      DELETE FROM session_containers WHERE session_id = @sessionId
    `);
    this.upsertSessionSettingsStmt = this.db.prepare(`
      INSERT INTO session_settings (
        id,
        session_id,
        github_repo,
        custom_env_vars,
        dockerfile_path,
        build_settings,
        git_remote_url,
        git_branch,
        auto_commit,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @sessionId,
        @githubRepo,
        @customEnvVars,
        @dockerfilePath,
        @buildSettings,
        @gitRemoteUrl,
        @gitBranch,
        @autoCommit,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(session_id) DO UPDATE SET
        github_repo = @githubRepo,
        custom_env_vars = @customEnvVars,
        dockerfile_path = @dockerfilePath,
        build_settings = @buildSettings,
        git_remote_url = @gitRemoteUrl,
        git_branch = @gitBranch,
        auto_commit = @autoCommit,
        updated_at = @updatedAt
    `);
    this.getSessionSettingsStmt = this.db.prepare(`
      SELECT
        id,
        session_id,
        github_repo,
        custom_env_vars,
        dockerfile_path,
        build_settings,
        git_remote_url,
        git_branch,
        auto_commit,
        created_at,
        updated_at
      FROM session_settings
      WHERE session_id = @sessionId
    `);
    this.initializeDeployConfig();
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
    const hasUserId = columns.some((column) => column.name === "user_id");
    if (!hasUserId) {
      this.db.exec(
        `ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE`,
      );
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    );
  }

  private ensureDeployConfigColumns(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(deploy_configs)`)
      .all() as Array<{ name: string }>;
    const hasSessionId = columns.some((column) => column.name === "session_id");
    if (!hasSessionId) {
      this.db.exec(
        `ALTER TABLE deploy_configs ADD COLUMN session_id TEXT DEFAULT NULL`,
      );
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_deploy_configs_session ON deploy_configs(session_id)`,
    );
  }

  /**
   * Migrates existing session_settings data to extract branch and remote URL from build_settings JSON.
   * This runs once to populate the new git_branch and git_remote_url columns from legacy data.
   */
  private migrateSessionSettingsBranchData(): void {
    // Get all session_settings that need migration
    const settings = this.db
      .prepare(`
        SELECT id, session_id, github_repo, build_settings, git_branch, git_remote_url
        FROM session_settings
        WHERE git_branch IS NULL OR git_remote_url IS NULL
      `)
      .all() as Array<{
        id: string;
        session_id: string;
        github_repo: string | null;
        build_settings: string;
        git_branch: string | null;
        git_remote_url: string | null;
      }>;

    const updateStmt = this.db.prepare(`
      UPDATE session_settings
      SET git_branch = @gitBranch, git_remote_url = @gitRemoteUrl
      WHERE id = @id
    `);

    this.db.transaction(() => {
      for (const setting of settings) {
        try {
          const buildSettings = JSON.parse(setting.build_settings || "{}");
          const gitBranch = setting.git_branch || buildSettings.branch || null;
          const gitRemoteUrl = setting.git_remote_url || setting.github_repo || null;

          // Only update if we found new data
          if (gitBranch !== setting.git_branch || gitRemoteUrl !== setting.git_remote_url) {
            updateStmt.run({
              id: setting.id,
              gitBranch,
              gitRemoteUrl,
            });
          }
        } catch (error) {
          // If JSON parsing fails, skip this record
          console.warn(`Failed to migrate session_settings for id ${setting.id}:`, error);
        }
      }
    })();
  }

  private initializeDeployConfig(): void {
    const existing = this.getDeployConfigStmt.get();
    if (existing) {
      return;
    }

    const defaultConfig: DeployConfig = {
      baseUrl: "",
      authMethod: "x-api-key",
      source: {
        type: "git",
        provider: "github",
        repository: "",
        branch: "",
      },
      env: [],
    };

    const now = new Date().toISOString();
    this.upsertDeployConfigStmt.run({
      id: "default",
      configJson: JSON.stringify(defaultConfig),
      apiKeyCipher: null,
      apiKeyIv: null,
      apiKeyTag: null,
      updatedAt: now,
    });
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

  private hydrateUserRow(row: UserRow | undefined | null): UserRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      isAdmin: Boolean(row.is_admin),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateLoginSessionRow(
    row: LoginSessionRow | undefined | null,
  ): LoginSessionRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private hydrateUserAuthFileRow(
    row: UserAuthFileRow | undefined | null,
  ): UserAuthFileRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider as UserAuthFileRecord["provider"],
      fileName: row.file_name,
      encryptedContent: row.encrypted_content,
      encryptedIv: row.encrypted_iv ?? null,
      encryptedTag: row.encrypted_tag ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getDatabasePath(): string {
    return databasePath;
  }

  createSession(title: string, userId: string): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: uuid(),
      title,
      codexThreadId: null,
      createdAt: now,
      updatedAt: now,
      workspacePath: "",
      titleLocked: false,
      userId,
    };

    this.insertSessionStmt.run({
      id: record.id,
      title: record.title,
      codexThreadId: record.codexThreadId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      titleLocked: record.titleLocked ? 1 : 0,
      userId: record.userId,
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

  listSessions(userId: string): SessionRecord[] {
    return this.listSessionsStmt
      .all({ userId })
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

  getDeployConfig(): DeployConfigRow | null {
    const row = this.getDeployConfigStmt.get();
    if (!row) {
      return null;
    }

    let parsed: DeployConfig;
    try {
      parsed = JSON.parse(row.config_json) as DeployConfig;
    } catch (error) {
      console.warn("[codex-webapp] Failed to parse stored Dokploy config:", error);
      parsed = {
        baseUrl: "",
        authMethod: "x-api-key",
        source: {
          type: "git",
          provider: "github",
        },
        env: [],
      };
    }

    return {
      id: row.id,
      config: parsed,
      updatedAt: row.updated_at,
      hasApiKey: Boolean(row.api_key_cipher),
    };
  }

  saveDeployConfig(input: {
    config: DeployConfig;
    apiKey?: string | null;
  }): DeployConfigRow {
    const existing = this.getDeployConfigStmt.get();
    let apiKeyCipher = existing?.api_key_cipher ?? null;
    let apiKeyIv = existing?.api_key_iv ?? null;
    let apiKeyTag = existing?.api_key_tag ?? null;

    if (input.apiKey !== undefined) {
      const trimmed = input.apiKey?.trim();
      if (trimmed && trimmed.length > 0) {
        const encrypted = encryptSecret(trimmed);
        if (encrypted) {
          apiKeyCipher = encrypted.cipherText;
          apiKeyIv = encrypted.iv;
          apiKeyTag = encrypted.tag;
        } else {
          apiKeyCipher = Buffer.from(trimmed, "utf8").toString("base64");
          apiKeyIv = null;
          apiKeyTag = null;
        }
      } else {
        apiKeyCipher = null;
        apiKeyIv = null;
        apiKeyTag = null;
      }
    }

    const updatedAt = new Date().toISOString();
    this.upsertDeployConfigStmt.run({
      id: "default",
      configJson: JSON.stringify(input.config),
      apiKeyCipher,
      apiKeyIv,
      apiKeyTag,
      updatedAt,
    });

    return {
      id: "default",
      config: input.config,
      updatedAt,
      hasApiKey: Boolean(apiKeyCipher),
    };
  }

  getDeployApiKey(): string | null {
    const row = this.getDeployConfigStmt.get();
    if (!row) {
      return null;
    }

    return decryptSecret(row.api_key_cipher ?? null, row.api_key_iv, row.api_key_tag);
  }

  createUser(input: {
    username: string;
    passwordHash: string;
    isAdmin: boolean;
  }): UserRecord {
    const now = new Date().toISOString();
    const normalizedUsername = input.username.trim().toLowerCase();
    const record: UserRecord = {
      id: uuid(),
      username: normalizedUsername,
      passwordHash: input.passwordHash,
      isAdmin: input.isAdmin,
      createdAt: now,
      updatedAt: now,
    };

    this.insertUserStmt.run({
      id: record.id,
      username: record.username,
      passwordHash: record.passwordHash,
      isAdmin: record.isAdmin ? 1 : 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    return record;
  }

  updateUser(id: string, updates: {
    passwordHash?: string;
    isAdmin?: boolean;
  }): UserRecord | null {
    const existing = this.getUserById(id);
    if (!existing) {
      return null;
    }

    const assignments: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.passwordHash !== undefined) {
      assignments.push("password_hash = @passwordHash");
      params.passwordHash = updates.passwordHash;
    }

    if (updates.isAdmin !== undefined) {
      assignments.push("is_admin = @isAdmin");
      params.isAdmin = updates.isAdmin ? 1 : 0;
    }

    if (assignments.length === 0) {
      return existing;
    }

    const updatedAt = new Date().toISOString();
    assignments.push("updated_at = @updatedAt");
    params.updatedAt = updatedAt;

    const statement = this.db.prepare(
      `UPDATE users SET ${assignments.join(", ")} WHERE id = @id`,
    );
    statement.run(params);

    const updated = this.getUserById(id);
    if (!updated) {
      return null;
    }
    return updated;
  }

  deleteUser(id: string): boolean {
    const result = this.deleteUserStmt.run({ id });
    return result.changes > 0;
  }

  getUserById(id: string): UserRecord | null {
    return this.hydrateUserRow(this.getUserByIdStmt.get({ id }));
  }

  getUserByUsername(username: string): UserRecord | null {
    return this.hydrateUserRow(
      this.getUserByUsernameStmt.get({ username }),
    );
  }

  listUsers(): UserRecord[] {
    return this.listUsersStmt
      .all()
      .map((row) => this.hydrateUserRow(row))
      .filter((record): record is UserRecord => record !== null);
  }

  createLoginSession(input: {
    userId: string;
    expiresAt: string;
  }): LoginSessionRecord {
    const record: LoginSessionRecord = {
      id: uuid(),
      userId: input.userId,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };

    this.insertLoginSessionStmt.run({
      id: record.id,
      userId: record.userId,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    });

    return record;
  }

  getLoginSession(id: string): LoginSessionRecord | null {
    return this.hydrateLoginSessionRow(
      this.getLoginSessionStmt.get({ id }),
    );
  }

  deleteLoginSession(id: string): void {
    this.deleteLoginSessionStmt.run({ id });
  }

  deleteLoginSessionsByUser(userId: string): void {
    this.deleteLoginSessionsByUserStmt.run({ userId });
  }

  deleteExpiredLoginSessions(now: string): number {
    const result = this.deleteExpiredLoginSessionsStmt.run({ now });
    return result.changes ?? 0;
  }

  upsertUserAuthFile(input: {
    userId: string;
    provider: UserAuthFileRecord["provider"];
    fileName: string;
    encryptedContent: string;
    encryptedIv: string | null;
    encryptedTag: string | null;
  }): UserAuthFileRecord {
    const existing = this.getUserAuthFile({
      userId: input.userId,
      provider: input.provider,
      fileName: input.fileName,
    });
    const now = new Date().toISOString();
    const id = existing?.id ?? uuid();
    const createdAt = existing?.createdAt ?? now;

    this.upsertUserAuthFileStmt.run({
      id,
      userId: input.userId,
      provider: input.provider,
      fileName: input.fileName,
      encryptedContent: input.encryptedContent,
      encryptedIv: input.encryptedIv,
      encryptedTag: input.encryptedTag,
      createdAt,
      updatedAt: now,
    });

    const updated = this.getUserAuthFile({
      userId: input.userId,
      provider: input.provider,
      fileName: input.fileName,
    });

    if (!updated) {
      throw new Error("Failed to retrieve stored auth file record");
    }

    return updated;
  }

  deleteUserAuthFile(input: {
    userId: string;
    provider: UserAuthFileRecord["provider"];
    fileName: string;
  }): boolean {
    const result = this.deleteUserAuthFileStmt.run({
      userId: input.userId,
      provider: input.provider,
      fileName: input.fileName,
    });
    return result.changes > 0;
  }

  listUserAuthFiles(userId: string): UserAuthFileRecord[] {
    return this.listUserAuthFilesStmt
      .all({ userId })
      .map((row) => this.hydrateUserAuthFileRow(row))
      .filter((record): record is UserAuthFileRecord => record !== null);
  }

  getUserAuthFile(input: {
    userId: string;
    provider: UserAuthFileRecord["provider"];
    fileName: string;
  }): UserAuthFileRecord | null {
    return this.hydrateUserAuthFileRow(
      this.getUserAuthFileStmt.get({
        userId: input.userId,
        provider: input.provider,
        fileName: input.fileName,
      }),
    );
  }

  // GitHub OAuth Token Management
  saveGitHubOAuthToken(input: {
    userId: string;
    accessToken: string;
    refreshToken?: string | null;
    tokenType?: string;
    scope?: string | null;
    expiresAt?: string | null;
  }): void {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT id FROM github_oauth_tokens WHERE user_id = ?`)
      .get(input.userId) as { id: string } | undefined;

    const id = existing?.id ?? uuid();

    // Encrypt the access token for security
    const encrypted = encryptSecret(input.accessToken);
    let tokenToStore: string;

    if (encrypted) {
      // Store as encrypted: ciphertext:iv:tag
      tokenToStore = `${encrypted.cipherText}:${encrypted.iv}:${encrypted.tag}`;
    } else {
      // Store as plain text if encryption is not available
      tokenToStore = input.accessToken;
    }

    this.db
      .prepare(
        `
      INSERT INTO github_oauth_tokens (
        id, user_id, access_token, refresh_token, token_type, scope, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_type = excluded.token_type,
        scope = excluded.scope,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        id,
        input.userId,
        tokenToStore, // Store encrypted or plain text token
        input.refreshToken ?? null,
        input.tokenType ?? "bearer",
        input.scope ?? null,
        input.expiresAt ?? null,
        existing ? existing.id : now,
        now,
      );
  }

  getGitHubOAuthToken(userId: string): {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  } | null {
    const row = this.db
      .prepare(
        `
      SELECT access_token, refresh_token, expires_at
      FROM github_oauth_tokens
      WHERE user_id = ?
    `,
      )
      .get(userId) as
      | {
          access_token: string;
          refresh_token: string | null;
          expires_at: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    // Handle both encrypted (ciphertext:iv:tag) and unencrypted tokens
    let accessToken: string;

    if (row.access_token.includes(":")) {
      // Encrypted token format: ciphertext:iv:tag
      const parts = row.access_token.split(":");
      if (parts.length === 3) {
        const [ciphertext, iv, tag] = parts;
        try {
          // Check if the parts look valid (not "null" or empty)
          if (!ciphertext || !iv || !tag || ciphertext === "null" || iv === "null" || tag === "null") {
            // Invalid encrypted format, treat as plain text
            accessToken = row.access_token;
          } else {
            const decrypted = decryptSecret(ciphertext, iv, tag);
            accessToken = decrypted || row.access_token; // Fallback to stored value if decryption fails
          }
        } catch (error) {
          // Decryption failed, treat as plain text
          console.warn("Failed to decrypt GitHub token, using plain text:", error);
          accessToken = row.access_token;
        }
      } else {
        // Unexpected format, treat as plain text
        accessToken = row.access_token;
      }
    } else {
      // Unencrypted token (saved before CODEX_WEBAPP_SECRET was configured)
      accessToken = row.access_token;
    }

    return {
      accessToken,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
    };
  }

  deleteGitHubOAuthToken(userId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM github_oauth_tokens WHERE user_id = ?`)
      .run(userId);
    return result.changes > 0;
  }

  upsertSessionContainer(input: {
    sessionId: string;
    dokployAppId: string | null;
    containerUrl: string | null;
    status: SessionContainerRecord["status"];
    errorMessage?: string | null;
  }): SessionContainerRecord {
    const existing = this.getSessionContainer(input.sessionId);
    const now = new Date().toISOString();
    const id = existing?.id ?? uuid();
    const createdAt = existing?.createdAt ?? now;

    this.upsertSessionContainerStmt.run({
      id,
      sessionId: input.sessionId,
      dokployAppId: input.dokployAppId,
      containerUrl: input.containerUrl,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      createdAt,
      updatedAt: now,
    });

    const updated = this.getSessionContainer(input.sessionId);
    if (!updated) {
      throw new Error("Failed to retrieve stored session container record");
    }
    return updated;
  }

  getSessionContainer(sessionId: string): SessionContainerRecord | null {
    const row = this.getSessionContainerStmt.get({ sessionId });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      sessionId: row.session_id,
      dokployAppId: row.dokploy_app_id,
      containerUrl: row.container_url,
      status: row.status as SessionContainerRecord["status"],
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deleteSessionContainer(sessionId: string): boolean {
    const result = this.deleteSessionContainerStmt.run({ sessionId });
    return result.changes > 0;
  }

  upsertSessionSettings(input: {
    sessionId: string;
    githubRepo?: string | null;
    customEnvVars?: Record<string, string>;
    dockerfilePath?: string | null;
    buildSettings?: Record<string, unknown>;
    gitRemoteUrl?: string | null;
    gitBranch?: string | null;
    autoCommit?: boolean;
  }): SessionSettingsRecord {
    const existing = this.getSessionSettings(input.sessionId);
    const now = new Date().toISOString();
    const id = existing?.id ?? uuid();
    const createdAt = existing?.createdAt ?? now;

    this.upsertSessionSettingsStmt.run({
      id,
      sessionId: input.sessionId,
      githubRepo: input.githubRepo ?? null,
      customEnvVars: JSON.stringify(input.customEnvVars ?? {}),
      dockerfilePath: input.dockerfilePath ?? null,
      buildSettings: JSON.stringify(input.buildSettings ?? {}),
      gitRemoteUrl: input.gitRemoteUrl ?? existing?.gitRemoteUrl ?? null,
      gitBranch: input.gitBranch ?? existing?.gitBranch ?? null,
      autoCommit: input.autoCommit !== undefined ? (input.autoCommit ? 1 : 0) : (existing?.autoCommit ? 1 : 1),
      createdAt,
      updatedAt: now,
    });

    const updated = this.getSessionSettings(input.sessionId);
    if (!updated) {
      throw new Error("Failed to retrieve stored session settings record");
    }
    return updated;
  }

  getSessionSettings(sessionId: string): SessionSettingsRecord | null {
    const row = this.getSessionSettingsStmt.get({ sessionId });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      sessionId: row.session_id,
      githubRepo: row.github_repo,
      customEnvVars: row.custom_env_vars,
      dockerfilePath: row.dockerfile_path,
      buildSettings: row.build_settings,
      gitRemoteUrl: row.git_remote_url,
      gitBranch: row.git_branch,
      autoCommit: Boolean(row.auto_commit),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
    responder?: {
      provider?: string | null;
      model?: string | null;
      reasoningEffort?: string | null;
    },
  ): MessageWithAttachments {
    const createdAt = new Date().toISOString();
    const responderProvider = responder?.provider ?? null;
    const responderModel = responder?.model ?? null;
    const responderReasoningEffort = responder?.reasoningEffort ?? null;

    const message: MessageRecord = {
      id: uuid(),
      sessionId,
      role,
      content,
      createdAt,
      responderProvider,
      responderModel,
      responderReasoningEffort,
    };

    this.insertMessageStmt.run({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      responderProvider,
      responderModel,
      responderReasoningEffort,
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

  private columnExists(tableName: string, columnName: string): boolean {
    const result = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    return result.some((col) => col.name === columnName);
  }

  private runMigrations(): void {
    this.db.transaction(() => {
      for (const migration of migrations) {
        // Skip ALTER TABLE ADD COLUMN if column already exists
        const addColumnMatch = migration.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
        if (addColumnMatch) {
          const [, tableName, columnName] = addColumnMatch;
          if (this.columnExists(tableName, columnName)) {
            console.log(`Column ${tableName}.${columnName} already exists, skipping migration`);
            continue;
          }
        }

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
