import type {
  CreateSessionResponse,
  AppMeta,
  AttachmentUpload,
  ListMessagesResponse,
  ListSessionsResponse,
  Message,
  PostMessageErrorResponse,
  PostMessageSuccessResponse,
  PostMessageStreamEvent,
  Session,
  ListWorkspaceFilesResponse,
  WorkspaceFile,
  WorkspaceFileContent,
  WorkspaceFileContentResponse,
  SessionWorkspaceInfo,
  BrowseWorkspaceResponse,
} from "./types";

export class ApiError<T = unknown> extends Error {
  readonly status: number;
  readonly body: T;

  constructor(status: number, body: T, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...init,
  });

  const hasBody = response.headers
    .get("Content-Type")
    ?.includes("application/json");
  const data = hasBody ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, data);
  }

  return data as T;
}

export async function fetchSessions(): Promise<Session[]> {
  const data = await request<ListSessionsResponse>("/api/sessions");
  return data.sessions;
}

const normalizeMessage = (message: Message): Message => ({
  ...message,
  attachments: message.attachments ?? [],
  items: message.items ?? [],
});

const normalizeReasoningEffort = (
  value: string | undefined,
): AppMeta["reasoningEffort"] => {
  const normalized = value?.toLowerCase();
  return normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
    ? normalized
    : "medium";
};

const normalizeReasoningEffortList = (
  values: string[] | undefined,
): AppMeta["reasoningEffort"][] => {
  if (!Array.isArray(values)) {
    return ["low", "medium", "high"];
  }

  const deduped = new Set<AppMeta["reasoningEffort"]>();
  for (const value of values) {
    deduped.add(normalizeReasoningEffort(value));
  }

  return deduped.size > 0 ? Array.from(deduped) : ["low", "medium", "high"];
};

export async function fetchMeta(): Promise<AppMeta> {
  const data = await request<{
    model: string;
    reasoningEffort: string;
    availableModels: string[];
    availableReasoningEfforts: string[];
  }>("/api/meta");

  const availableReasoningEfforts = normalizeReasoningEffortList(
    data.availableReasoningEfforts,
  );

  const availableModels =
    Array.isArray(data.availableModels) && data.availableModels.length > 0
      ? Array.from(
          new Set(
            data.availableModels
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          ),
        )
      : ["gpt-5-codex", "gpt-5"];

  const model = availableModels.includes(data.model)
    ? data.model
    : (availableModels[0] ?? "gpt-5-codex");

  return {
    model,
    reasoningEffort: normalizeReasoningEffort(data.reasoningEffort),
    availableModels,
    availableReasoningEfforts,
  };
}

export async function updateMeta(payload: {
  model?: string;
  reasoningEffort?: AppMeta["reasoningEffort"];
}): Promise<AppMeta> {
  const data = await request<{
    model: string;
    reasoningEffort: string;
    availableModels: string[];
    availableReasoningEfforts: string[];
  }>("/api/meta", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  const availableReasoningEfforts = normalizeReasoningEffortList(
    data.availableReasoningEfforts,
  );

  const availableModels =
    Array.isArray(data.availableModels) && data.availableModels.length > 0
      ? Array.from(
          new Set(
            data.availableModels
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          ),
        )
      : ["gpt-5-codex", "gpt-5"];

  const model = availableModels.includes(data.model)
    ? data.model
    : (availableModels[0] ?? "gpt-5-codex");

  return {
    model,
    reasoningEffort: normalizeReasoningEffort(data.reasoningEffort),
    availableModels,
    availableReasoningEfforts,
  };
}

export async function createSession(title?: string): Promise<Session> {
  const data = await request<CreateSessionResponse>("/api/sessions", {
    method: "POST",
    body: title ? JSON.stringify({ title }) : undefined,
  });

  return data.session;
}

export async function deleteSession(id: string): Promise<void> {
  await request<void>(`/api/sessions/${id}`, {
    method: "DELETE",
  });
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  const data = await request<ListMessagesResponse>(
    `/api/sessions/${sessionId}/messages`,
  );
  return data.messages.map((message) => normalizeMessage(message));
}

export async function* streamPostMessage(
  sessionId: string,
  payload: {
    content: string;
    attachments?: AttachmentUpload[];
  },
): AsyncGenerator<PostMessageStreamEvent> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorBody: unknown = null;
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }
    } else {
      try {
        const text = await response.text();
        errorBody = text.length > 0 ? { message: text } : null;
      } catch {
        errorBody = null;
      }
    }
    throw new ApiError(response.status, errorBody);
  }

  if (!response.body) {
    throw new Error(
      "Streaming responses are not supported in this environment.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const decoderAny: { decode: (...args: any[]) => string } =
    decoder as unknown as { decode: (...args: any[]) => string };
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoderAny.decode();
        break;
      }

      const chunkText = decoderAny.decode(value, { stream: true });
      buffer += chunkText;

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.trim();
        if (line.length > 0) {
          let parsed: PostMessageStreamEvent;
          try {
            parsed = JSON.parse(line) as PostMessageStreamEvent;
          } catch (error) {
            throw new Error(`Failed to parse stream event: ${line}`);
          }
          yield parsed;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  const remaining = buffer.trim();
  if (remaining.length > 0) {
    let parsed: PostMessageStreamEvent;
    try {
      parsed = JSON.parse(remaining) as PostMessageStreamEvent;
    } catch (error) {
      throw new Error(`Failed to parse stream event: ${remaining}`);
    }
    yield parsed;
  }
}

export async function fetchSessionWorkspaceInfo(
  sessionId: string,
): Promise<SessionWorkspaceInfo> {
  const data = await request<{ workspace: SessionWorkspaceInfo }>(
    `/api/sessions/${sessionId}/workspace`,
  );
  return data.workspace;
}

export async function updateSessionWorkspacePath(
  sessionId: string,
  nextPath: string,
): Promise<{ workspace: SessionWorkspaceInfo; session: Session }> {
  return request<{ workspace: SessionWorkspaceInfo; session: Session }>(
    `/api/sessions/${sessionId}/workspace`,
    {
      method: "POST",
      body: JSON.stringify({ path: nextPath }),
    },
  );
}

export async function browseSessionWorkspaceDirectories(
  sessionId: string,
  path?: string,
): Promise<BrowseWorkspaceResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<BrowseWorkspaceResponse>(
    `/api/sessions/${sessionId}/workspace/browse${query}`,
  );
}

export async function postMessage(
  sessionId: string,
  payload: {
    content: string;
    attachments?: AttachmentUpload[];
  },
): Promise<PostMessageSuccessResponse> {
  return request<PostMessageSuccessResponse>(
    `/api/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export type PostMessageResult =
  | { status: "ok"; data: PostMessageSuccessResponse }
  | { status: "error"; error: ApiError<PostMessageErrorResponse> };

export async function safePostMessage(
  sessionId: string,
  payload: {
    content: string;
    attachments?: AttachmentUpload[];
  },
): Promise<PostMessageResult> {
  try {
    const data = await postMessage(sessionId, payload);
    const normalized = {
      ...data,
      userMessage: normalizeMessage(data.userMessage),
      assistantMessage: (() => {
        const assistant = normalizeMessage(data.assistantMessage);
        assistant.items = data.items ?? [];
        return assistant;
      })(),
    };
    return { status: "ok", data: normalized };
  } catch (error) {
    if (error instanceof ApiError && error.body) {
      return { status: "error", error };
    }
    throw error;
  }
}

export async function fetchWorkspaceFiles(
  sessionId: string,
): Promise<WorkspaceFile[]> {
  const data = await request<ListWorkspaceFilesResponse>(
    `/api/sessions/${sessionId}/files`,
  );
  return data.files;
}

export async function fetchWorkspaceFileContent(
  sessionId: string,
  filePath: string,
): Promise<WorkspaceFileContent> {
  const params = new URLSearchParams({ path: filePath });
  const data = await request<WorkspaceFileContentResponse>(
    `/api/sessions/${sessionId}/files/content?${params.toString()}`,
  );
  return data.file;
}

export async function saveWorkspaceFile(
  sessionId: string,
  payload: { path: string; content: string },
): Promise<WorkspaceFileContent> {
  const data = await request<WorkspaceFileContentResponse>(
    `/api/sessions/${sessionId}/files/content`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );

  return data.file;
}
