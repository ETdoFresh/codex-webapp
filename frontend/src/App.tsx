import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import StatusChip from './components/StatusChip';
import { useHealthStatus } from './hooks/useHealthStatus';
import {
  createSession,
  deleteSession,
  fetchMeta,
  fetchMessages,
  fetchSessions,
  safePostMessage
} from './api/client';
import type { AppMeta, Message, PostMessageErrorResponse, Session } from './api/types';

const DEFAULT_SESSION_TITLE = 'New Chat';
const THEME_STORAGE_KEY = 'codex:theme';

type Theme = 'light' | 'dark';

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'dark';
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.dataset.theme = stored;
      return stored;
    }
  } catch (error) {
    console.warn('Unable to read theme preference', error);
  }

  document.documentElement.dataset.theme = 'dark';
  return 'dark';
};

const sessionDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric'
});

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: 'numeric'
});

const sortSessions = (sessions: Session[]) =>
  [...sessions].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

function App() {
  const health = useHealthStatus();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [composerValue, setComposerValue] = useState('');
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  useEffect(() => {
    let canceled = false;

    const loadSessions = async () => {
      setLoadingSessions(true);
      try {
        const data = await fetchSessions();
        if (canceled) {
          return;
        }

        const sorted = sortSessions(data);
        setSessions(sorted);
        setActiveSessionId((previous) => previous ?? sorted[0]?.id ?? null);
      } catch (error) {
        console.error('Failed to load sessions', error);
      } finally {
        if (!canceled) {
          setLoadingSessions(false);
        }
      }
    };

    void loadSessions();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    let canceled = false;
    const loadMessages = async () => {
      setLoadingMessages(true);
      try {
        const data = await fetchMessages(activeSessionId);
        if (canceled) {
          return;
        }
        setMessages(data);
      } catch (error) {
        console.error('Failed to load messages', error);
      } finally {
        if (!canceled) {
          setLoadingMessages(false);
        }
      }
    };

    void loadMessages();

    return () => {
      canceled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let canceled = false;
    const loadMeta = async () => {
      try {
        const settings = await fetchMeta();
        if (!canceled) {
          setMeta(settings);
        }
      } catch (error) {
        console.warn('Failed to load application metadata', error);
      }
    };

    void loadMeta();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn('Unable to persist theme preference', error);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'));
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    const { ctrlKey, metaKey, shiftKey } = event;
    const textarea = event.currentTarget;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? value.length;
    const selectionEnd = textarea.selectionEnd ?? value.length;
    const cursorAtEnd = selectionStart === value.length && selectionEnd === value.length;
    const shouldSubmit = ctrlKey || metaKey || (!shiftKey && cursorAtEnd);

    if (!shouldSubmit) {
      return;
    }

    event.preventDefault();
    textarea.form?.requestSubmit?.();
  };

  const handleCreateSession = async () => {
    if (creatingSession) {
      return;
    }

    setCreatingSession(true);
    setErrorNotice(null);

    try {
      const session = await createSession();
      setSessions((prev) => sortSessions([session, ...prev]));
      setActiveSessionId(session.id);
      setMessages([]);
      setComposerValue('');
    } catch (error) {
      console.error('Failed to create session', error);
      setErrorNotice('Unable to create a new session. Please try again.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    if (sessionId === activeSessionId) {
      return;
    }
    setActiveSessionId(sessionId);
    setErrorNotice(null);
    setComposerValue('');
  };

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSessionId) {
      return;
    }

    const content = composerValue.trim();
    if (!content) {
      return;
    }

    setSendingMessage(true);
    setErrorNotice(null);

    try {
      const result = await safePostMessage(activeSessionId, content);

      if (result.status === 'ok') {
        const { data } = result;

        setMessages((prev) => [...prev, data.userMessage, data.assistantMessage]);
        setComposerValue('');

        setSessions((prev) => {
          const updated = prev.map((session) => {
            if (session.id !== activeSessionId) {
              return session;
            }

            const inferredTitle =
              session.title === DEFAULT_SESSION_TITLE
                ? content.length > 60
                  ? `${content.slice(0, 60).trim()}…`
                  : content
                : session.title;

            return {
              ...session,
              title: inferredTitle,
              codexThreadId: data.threadId ?? session.codexThreadId,
              updatedAt: data.assistantMessage.createdAt
            };
          });

          return sortSessions(updated);
        });
      } else {
        const { error } = result;
        const body = error.body;

        if (body && typeof body === 'object' && 'userMessage' in body) {
          const apiBody = body as PostMessageErrorResponse;
          setMessages((prev) => [
            ...prev,
            apiBody.userMessage,
            {
              id: `error-${Date.now()}`,
              role: 'system',
              content: `Codex error: ${apiBody.message}`,
              createdAt: new Date().toISOString()
            }
          ]);
          setSessions((prev) => sortSessions(prev));
          setErrorNotice(apiBody.message);
        } else {
          console.error('Unexpected error body', error);
          setErrorNotice('Unexpected error from Codex.');
        }
      }
    } catch (error) {
      console.error('Failed to send message', error);
      setErrorNotice('Failed to send message. Check your connection and try again.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) {
      return;
    }

    try {
      await deleteSession(sessionId);
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);

      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0]?.id ?? null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete session', error);
      setErrorNotice('Unable to delete the session.');
    }
  };

  const isComposerDisabled =
    !activeSessionId || sendingMessage || loadingMessages || creatingSession;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Codex Chat Studio</h1>
          <p className="muted">
            Multi-session workspace backed by the Codex SDK and persistent history
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <StatusChip status={health.status} lastUpdated={health.lastUpdated} />
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Sessions</h2>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleCreateSession()}
              disabled={creatingSession}
            >
              {creatingSession ? 'Creating…' : 'New Chat'}
            </button>
          </div>

          {loadingSessions ? (
            <p className="sidebar-empty muted">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <div className="sidebar-empty">
              <p className="muted">No sessions yet.</p>
              <button type="button" onClick={() => void handleCreateSession()}>
                Start your first chat
              </button>
            </div>
          ) : (
            <ul className="session-list">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const shortId = session.id.slice(0, 8);
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`session-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectSession(session.id)}
                    >
                      <span className="session-title">{session.title}</span>
                      <div className="session-meta">
                        <span className="session-timestamp">
                          {sessionDateFormatter.format(new Date(session.updatedAt))}
                        </span>
                        <code className="session-id-badge">{shortId}</code>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="session-delete"
                      onClick={() => void handleDeleteSession(session.id)}
                      aria-label={`Delete session ${session.title}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="chat-panel">
          {activeSession ? (
            <>
              <header className="chat-header">
                <div>
                  <h2>{activeSession.title}</h2>
                  <p className="muted">
                    Updated {sessionDateFormatter.format(new Date(activeSession.updatedAt))}
                  </p>
                </div>
              </header>

              <div className="message-panel">
                <div className="message-list" ref={messageListRef}>
                  {loadingMessages ? (
                    <div className="message-placeholder">Loading conversation…</div>
                  ) : messages.length === 0 ? (
                    <div className="message-placeholder">
                      Send a message to kick off this conversation.
                    </div>
                  ) : (
                    messages.map((message) => (
                      <article
                        key={message.id}
                        className={`message message-${message.role}`}
                      >
                        <header className="message-meta">
                          <span className="message-role">
                            {message.role === 'assistant'
                              ? 'Codex'
                              : message.role === 'user'
                              ? 'You'
                              : 'System'}
                          </span>
                          <span className="message-timestamp">
                            {messageTimeFormatter.format(new Date(message.createdAt))}
                          </span>
                        </header>
                        <pre className="message-content">{message.content}</pre>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <form className="composer" onSubmit={handleSendMessage}>
                <textarea
                  placeholder="Ask Codex anything…"
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  disabled={isComposerDisabled}
                  rows={3}
                />
                <div className="composer-footer">
                  <div className="composer-meta">
                    <span>
                      Model{' '}
                      <code>{(meta?.model ?? 'gpt-5-codex').toLowerCase()}</code>
                    </span>
                    <span>
                      Reasoning effort{' '}
                      <strong>{(meta?.reasoningEffort ?? 'medium').toUpperCase()}</strong>
                    </span>
                  </div>
                  <button type="submit" disabled={isComposerDisabled}>
                    {sendingMessage ? 'Thinking…' : 'Send'}
                  </button>
                </div>
              </form>

              {errorNotice ? <div className="error-banner">{errorNotice}</div> : null}
            </>
          ) : (
            <div className="empty-chat">
              <p>Select a session or start a new chat to begin.</p>
              <button type="button" onClick={() => void handleCreateSession()}>
                Create Session
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
