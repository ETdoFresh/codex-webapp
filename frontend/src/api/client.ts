import type {
  CreateSessionResponse,
  AppMeta,
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

export async function fetchMeta(): Promise<AppMeta> {
  const data = await request<{ model: string; reasoningEffort: string }>('/api/meta');
  const supportedEffort = new Set(['low', 'medium', 'high']);
  const effort = supportedEffort.has(data.reasoningEffort)
    ? (data.reasoningEffort as AppMeta['reasoningEffort'])
    : 'medium';
  return {
    model: data.model ?? 'gpt-5-codex',
    reasoningEffort: effort
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
  return data.messages;
}

export async function postMessage(
  sessionId: string,
  content: string
): Promise<PostMessageSuccessResponse> {
  return request<PostMessageSuccessResponse>(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
}

export type PostMessageResult =
  | { status: 'ok'; data: PostMessageSuccessResponse }
  | { status: 'error'; error: ApiError<PostMessageErrorResponse> };

export async function safePostMessage(
  sessionId: string,
  content: string
): Promise<PostMessageResult> {
  try {
    const data = await postMessage(sessionId, content);
    return { status: 'ok', data };
  } catch (error) {
    if (error instanceof ApiError && error.body) {
      return { status: 'error', error };
    }
    throw error;
  }
}
