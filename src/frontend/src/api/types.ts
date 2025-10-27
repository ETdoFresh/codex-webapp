export type Session = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  titleLocked: boolean;
};

export type MessageRole = "system" | "user" | "assistant";

export type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
};

export type Message = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  attachments: Attachment[];
  items?: TurnItem[];
};

export type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
} | null;

export type TurnItem = {
  type: string;
  [key: string]: unknown;
};

export type CreateSessionResponse = {
  session: Session;
};

export type ListSessionsResponse = {
  sessions: Session[];
};

export type ListMessagesResponse = {
  messages: Message[];
};

export type PostMessageSuccessResponse = {
  sessionId: string;
  threadId: string | null;
  userMessage: Message;
  assistantMessage: Message;
  usage: Usage;
  items: TurnItem[];
};

export type PostMessageErrorResponse = {
  error: string;
  message: string;
  userMessage: Message;
};

export type PostMessageStreamEvent =
  | {
      type: "user_message";
      message: Message;
    }
  | {
      type: "assistant_message_snapshot";
      message: Message;
    }
  | {
      type: "assistant_message_final";
      message: Message;
      temporaryId: string;
      session: Session;
      usage: Usage;
    }
  | {
      type: "error";
      message: string;
      temporaryId?: string;
    }
  | {
      type: "done";
    };

export type AppMeta = {
  provider: "CodexSDK" | "ClaudeCodeSDK" | "GeminiSDK";
  availableProviders: Array<"CodexSDK" | "ClaudeCodeSDK" | "GeminiSDK">;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  availableModels: string[];
  availableReasoningEfforts: Array<"low" | "medium" | "high">;
};

export type AttachmentUpload = {
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
};

export type WorkspaceFile = {
  path: string;
  size: number;
  updatedAt: string;
};

export type WorkspaceFileContent = WorkspaceFile & {
  content: string;
};

export type ListWorkspaceFilesResponse = {
  files: WorkspaceFile[];
};

export type WorkspaceFileContentResponse = {
  file: WorkspaceFileContent;
};

export type SessionWorkspaceInfo = {
  path: string;
  defaultPath: string;
  isDefault: boolean;
  exists: boolean;
};

export type DirectoryEntry = {
  name: string;
  path: string;
};

export type BrowseWorkspaceResponse = {
  targetPath: string;
  exists: boolean;
  isDirectory: boolean;
  parentPath: string | null;
  canCreate: boolean;
  entries: DirectoryEntry[];
  entriesTruncated: boolean;
  quickAccess: string[];
  error: string | null;
};
