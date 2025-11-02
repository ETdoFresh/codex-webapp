/**
 * Shared message types
 */

export type MessageRole = "user" | "assistant" | "system";

export type TurnItem = {
  type: string;
  [key: string]: unknown;
};

export type MessageAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  relativePath: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  attachments: MessageAttachment[];
  items: TurnItem[];
  responderProvider: string | null;
  responderModel: string | null;
  responderReasoningEffort: string | null;
  createdAt: string;
};

export type StreamChunk = {
  type: "content" | "item" | "complete";
  content?: string;
  item?: TurnItem;
  messageId?: string;
};

export type WebhookMessagePayload = {
  role: MessageRole;
  content: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    relativePath: string;
  }>;
  items: TurnItem[];
  responderProvider: string | null;
  responderModel: string | null;
  responderReasoningEffort: string | null;
};
