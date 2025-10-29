import type { ThreadItem } from "@openai/codex-sdk";
import type {
  AttachmentRecord,
  DeployConfigRow,
  LoginSessionRecord,
  MessageWithAttachments,
  NewAttachmentInput,
  SessionRecord,
  UserAuthFileRecord,
  UserRecord,
} from "../types/database";

interface IDatabase {
  createSession(title: string, userId: string): SessionRecord;
  listSessions(userId: string): SessionRecord[];
  getSession(id: string): SessionRecord | null;
  updateSessionTitle(id: string, title: string): SessionRecord | null;
  updateSessionThreadId(
    id: string,
    codexThreadId: string | null,
  ): SessionRecord | null;
  updateSessionWorkspacePath(
    id: string,
    workspacePath: string,
  ): SessionRecord | null;
  updateSessionTitleLocked(id: string, locked: boolean): SessionRecord | null;
  updateSessionTitleFromMessages(
    id: string,
    messages: unknown[],
  ): Promise<SessionRecord | null>;
  deleteSession(id: string): boolean;
  addMessage(
    sessionId: string,
    role: MessageWithAttachments["role"],
    content: string,
    attachments?: NewAttachmentInput[],
    items?: ThreadItem[],
  ): MessageWithAttachments;
  listMessages(sessionId: string): MessageWithAttachments[];
  getDatabasePath(): string;
  getAttachment(id: string): AttachmentRecord | null;
  resetAllSessionThreads(): void;
  getDeployConfig(): DeployConfigRow | null;
  saveDeployConfig(input: {
    config: DeployConfigRow["config"];
    apiKey?: string | null;
  }): DeployConfigRow;
  getDeployApiKey(): string | null;

  createUser(input: {
    username: string;
    passwordHash: string;
    isAdmin: boolean;
  }): UserRecord;
  updateUser(id: string, updates: {
    passwordHash?: string;
    isAdmin?: boolean;
  }): UserRecord | null;
  deleteUser(id: string): boolean;
  getUserById(id: string): UserRecord | null;
  getUserByUsername(username: string): UserRecord | null;
  listUsers(): UserRecord[];

  createLoginSession(input: {
    userId: string;
    expiresAt: string;
  }): LoginSessionRecord;
  getLoginSession(id: string): LoginSessionRecord | null;
  deleteLoginSession(id: string): void;
  deleteLoginSessionsByUser(userId: string): void;
  deleteExpiredLoginSessions(now: string): number;

  upsertUserAuthFile(input: {
    userId: string;
    provider: UserAuthFileRecord["provider"];
    fileName: string;
    encryptedContent: string;
    encryptedIv: string | null;
    encryptedTag: string | null;
  }): UserAuthFileRecord;
  deleteUserAuthFile(input: {
    userId: string;
    provider: UserAuthFileRecord["provider"];
    fileName: string;
  }): boolean;
  listUserAuthFiles(userId: string): UserAuthFileRecord[];
  getUserAuthFile(input: {
    userId: string;
    provider: UserAuthFileRecord["provider"];
    fileName: string;
  }): UserAuthFileRecord | null;
}

export default IDatabase;
