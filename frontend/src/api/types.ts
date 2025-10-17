export type Session = {
  id: string;
  title: string;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = 'system' | 'user' | 'assistant';

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

export type AppMeta = {
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  availableModels: string[];
  availableReasoningEfforts: Array<'low' | 'medium' | 'high'>;
};

export type AttachmentUpload = {
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
};
