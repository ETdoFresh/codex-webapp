import type {
  CreateSessionResponse,
  AppMeta,
  AttachmentUpload,
  ListMessagesResponse,
  ListSessionsResponse,
  Message,
  PostMessageErrorResponse,
  PostMessageSuccessResponse,
  Session
} from './types';

export class ApiError<T = unknown> extends Error {
  readonly status: number;
  readonly body: T;

  constructor(status: number, body: T, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...init
  });

  const hasBody = response.headers.get('Content-Type')?.includes('application/json');
  const data = hasBody ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, data);
  }

  return data as T;
}

export async function fetchSessions(): Promise<Session[]> {
  const data = await request<ListSessionsResponse>('/api/sessions');
  return data.sessions;
}

const normalizeMessage = (message: Message): Message => ({
  ...message,
  attachments: message.attachments ?? []
});

const normalizeReasoningEffort = (value: string | undefined): AppMeta['reasoningEffort'] => {
  const normalized = value?.toLowerCase();
  return normalized === 'low' || normalized === 'medium' || normalized === 'high'
    ? normalized
    : 'medium';
};

const normalizeReasoningEffortList = (
  values: string[] | undefined
): AppMeta['reasoningEffort'][] => {
  if (!Array.isArray(values)) {
    return ['low', 'medium', 'high'];
  }

  const deduped = new Set<AppMeta['reasoningEffort']>();
  for (const value of values) {
    deduped.add(normalizeReasoningEffort(value));
  }

  return deduped.size > 0 ? Array.from(deduped) : ['low', 'medium', 'high'];
};

export async function fetchMeta(): Promise<AppMeta> {
  const data = await request<{
    model: string;
    reasoningEffort: string;
    availableModels: string[];
    availableReasoningEfforts: string[];
  }>('/api/meta');

  const availableReasoningEfforts = normalizeReasoningEffortList(data.availableReasoningEfforts);

  const availableModels = Array.isArray(data.availableModels) && data.availableModels.length > 0
    ? Array.from(new Set(data.availableModels.map((item) => item.trim()).filter((item) => item.length > 0)))
    : ['gpt-5-codex', 'gpt-5'];

  const model = availableModels.includes(data.model)
    ? data.model
    : availableModels[0] ?? 'gpt-5-codex';

  return {
    model,
    reasoningEffort: normalizeReasoningEffort(data.reasoningEffort),
    availableModels,
    availableReasoningEfforts
  };
}

export async function updateMeta(payload: {
  model?: string;
  reasoningEffort?: AppMeta['reasoningEffort'];
}): Promise<AppMeta> {
  const data = await request<{
    model: string;
    reasoningEffort: string;
    availableModels: string[];
    availableReasoningEfforts: string[];
  }>('/api/meta', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  const availableReasoningEfforts = normalizeReasoningEffortList(data.availableReasoningEfforts);

  const availableModels = Array.isArray(data.availableModels) && data.availableModels.length > 0
    ? Array.from(new Set(data.availableModels.map((item) => item.trim()).filter((item) => item.length > 0)))
    : ['gpt-5-codex', 'gpt-5'];

  const model = availableModels.includes(data.model)
    ? data.model
    : availableModels[0] ?? 'gpt-5-codex';

  return {
    model,
    reasoningEffort: normalizeReasoningEffort(data.reasoningEffort),
    availableModels,
    availableReasoningEfforts
  };
}

export async function createSession(title?: string): Promise<Session> {
  const data = await request<CreateSessionResponse>('/api/sessions', {
    method: 'POST',
    body: title ? JSON.stringify({ title }) : undefined
  });

  return data.session;
}

export async function deleteSession(id: string): Promise<void> {
  await request<void>(`/api/sessions/${id}`, {
    method: 'DELETE'
  });
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  const data = await request<ListMessagesResponse>(`/api/sessions/${sessionId}/messages`);
  return data.messages.map((message) => normalizeMessage(message));
}

export async function postMessage(
  sessionId: string,
  payload: {
    content: string;
    attachments?: AttachmentUpload[];
  }
): Promise<PostMessageSuccessResponse> {
  return request<PostMessageSuccessResponse>(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export type PostMessageResult =
  | { status: 'ok'; data: PostMessageSuccessResponse }
  | { status: 'error'; error: ApiError<PostMessageErrorResponse> };

export async function safePostMessage(
  sessionId: string,
  payload: {
    content: string;
    attachments?: AttachmentUpload[];
  }
): Promise<PostMessageResult> {
  try {
    const data = await postMessage(sessionId, payload);
    const normalized = {
      ...data,
      userMessage: normalizeMessage(data.userMessage),
      assistantMessage: normalizeMessage(data.assistantMessage)
    };
    return { status: 'ok', data: normalized };
  } catch (error) {
    if (error instanceof ApiError && error.body) {
      return { status: 'error', error };
    }
    throw error;
  }
}
