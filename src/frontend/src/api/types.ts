import type {
  DeployConfig,
  DeployConfigResponse,
  DeployEnvVar,
} from "../../../shared/dokploy";

export type Session = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  titleLocked: boolean;
  gitBranch?: string | null;
};

export type AuthUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LoginRequest = {
  username: string;
  password: string;
  rememberMe?: boolean;
};

export type LoginResponse = {
  user: AuthUser;
};

export type MeResponse = {
  user: AuthUser;
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
  responderProvider?: string | null;
  responderModel?: string | null;
  responderReasoningEffort?: string | null;
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

export type ProviderOption = "CodexSDK" | "ClaudeCodeSDK" | "DroidCLI" | "CopilotCLI" | "GeminiSDK";
export type ReasoningEffort = "low" | "medium" | "high";

export type AppMeta = {
  provider: ProviderOption;
  availableProviders: ProviderOption[];
  model: string;
  reasoningEffort: ReasoningEffort;
  availableModels: string[];
  availableReasoningEfforts: ReasoningEffort[];
  modelsByProvider: Record<ProviderOption, string[]>;
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

export type DeployConfigPayload = DeployConfig & {
  apiKey?: string | null;
};

export type DeployConfigResult = DeployConfigResponse & {
  env?: DeployEnvVar[];
};

export type DeployTestResponse = {
  ok: boolean;
  projects?: unknown;
  error?: string;
};

export type DeployProjectsResponse = {
  projects: unknown[];
};

export type DeployApplicationsResponse = {
  applications: Array<{
    applicationId: string;
    name: string;
    description: string;
  }>;
};

export type DeployUploadResponse = {
  artifactKey: string;
  artifactUrl: string;
  expiresAt: string;
  size: number;
  config: DeployConfigResult;
};

export type UserListResponse = {
  users: AuthUser[];
};

export type UserDetailResponse = {
  user: AuthUser;
};

export type CreateUserRequest = {
  username: string;
  password: string;
  isAdmin: boolean;
};

export type UpdateUserRequest = {
  password?: string;
  isAdmin?: boolean;
};

export type UserAuthFileSummary = {
  id: string;
  provider: 'codex' | 'claude' | 'droid' | 'copilot';
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

export type ListUserAuthFilesResponse = {
  files: UserAuthFileSummary[];
};

export type SaveUserAuthFileRequest = {
  content: string;
};

export type UserAuthFileDetail = {
  provider: 'codex' | 'claude' | 'droid' | 'copilot';
  fileName: string;
  content: string;
  updatedAt: string;
};

export type UserAuthFileDetailResponse = {
  file: UserAuthFileDetail;
};
