import type { ThreadItem } from "@openai/codex-sdk";
import type {
  AttachmentRecord,
  MessageWithAttachments,
  NewAttachmentInput,
  SessionRecord,
} from "../types/database";

interface IDatabase {
  createSession(title: string): SessionRecord;
  listSessions(): SessionRecord[];
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
}

export default IDatabase;
