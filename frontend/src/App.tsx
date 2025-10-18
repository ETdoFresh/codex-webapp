import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  ClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import StatusChip from './components/StatusChip';
import { useHealthStatus } from './hooks/useHealthStatus';
import {
  createSession,
  deleteSession,
  fetchMeta,
  fetchMessages,
  fetchSessions,
  safePostMessage,
  updateMeta
} from './api/client';
import type { AppMeta, Message, PostMessageErrorResponse, Session, TurnItem } from './api/types';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const DEFAULT_SESSION_TITLE = 'New Chat';
const THEME_STORAGE_KEY = 'codex:theme';

const FALLBACK_MODELS = ['gpt-5-codex', 'gpt-5'];
const FALLBACK_REASONING: AppMeta['reasoningEffort'][] = ['low', 'medium', 'high'];

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

const MAX_COMPOSER_ATTACHMENTS = 4;
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  base64: string;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const summarizeReasoningItem = (
  item: TurnItem
): { text: string | null; additional: string | null; lines: string[] } => {
  const record = item as Record<string, unknown>;
  const rawText = record.text;
  const candidateText = typeof rawText === 'string' ? rawText.trim() : '';

  const text = candidateText.length > 0 ? candidateText : null;

  const clone: Record<string, unknown> = { ...item };
  delete clone.type;
  if ('text' in clone) {
    delete clone.text;
  }
  if ('id' in clone) {
    delete clone.id;
  }

  let additional =
    Object.keys(clone).length > 0 ? JSON.stringify(clone, null, 2) : null;

  if (!text && !additional) {
    additional = JSON.stringify(item, null, 2);
  }

  const lines = text ? text.split(/\r?\n/) : [];

  return { text, additional, lines };
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
  const [updatingMeta, setUpdatingMeta] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [imagePreview, setImagePreview] = useState<{ url: string; filename: string } | null>(null);
  const [chatViewMode, setChatViewMode] = useState<'formatted' | 'detailed' | 'raw'>('formatted');
  const [reasoningExpandedByMessageId, setReasoningExpandedByMessageId] = useState<Record<string, boolean>>({});
  const [defaultReasoningExpanded, setDefaultReasoningExpanded] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const rawMessagesJson = useMemo(() => JSON.stringify(messages, null, 2), [messages]);
  const isRawView = chatViewMode === 'raw';
  const isDetailedView = chatViewMode === 'detailed';
  const markdownPlugins = useMemo(() => [remarkGfm], []);
  const inlineMarkdownComponents = useMemo<Components>(
    () => ({
      p: ({ node, ...props }) => <span {...props} />,
      a: ({ node, ...props }) => (
        <a {...props} target="_blank" rel="noreferrer" />
      )
    }),
    []
  );
  const blockMarkdownComponents = useMemo<Components>(
    () => ({
      a: ({ node, ...props }) => (
        <a {...props} target="_blank" rel="noreferrer" />
      )
    }),
    []
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
    if (chatViewMode === 'raw') {
      return;
    }

    const container = messageListRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, chatViewMode]);

  useEffect(() => {
    setComposerAttachments([]);
  }, [activeSessionId]);

  useEffect(() => {
    setReasoningExpandedByMessageId({});
    setDefaultReasoningExpanded(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (messages.length === 0) {
      setReasoningExpandedByMessageId((previous) =>
        Object.keys(previous).length > 0 ? {} : previous
      );
      return;
    }

    setReasoningExpandedByMessageId((previous) => {
      let changed = false;
      const nextState = { ...previous };
      for (const message of messages) {
        if (
          message.role === 'assistant' &&
          (message.items?.length ?? 0) > 0 &&
          nextState[message.id] === undefined
        ) {
          nextState[message.id] = defaultReasoningExpanded;
          changed = true;
        }
      }

      return changed ? nextState : previous;
    });
  }, [messages, defaultReasoningExpanded]);

  useEffect(() => {
    if (!imagePreview) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImagePreview(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [imagePreview]);

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

  const readFileAsDataUrl = useCallback(
    (file: File): Promise<{ dataUrl: string; base64: string }> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== 'string') {
            reject(new Error('Unable to read file.'));
            return;
          }
          const [, base64 = ''] = result.split(',');
          resolve({ dataUrl: result, base64 });
        };
        reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
        reader.readAsDataURL(file);
      }),
    []
  );

  const addAttachments = useCallback(
    async (files: File[]) => {
      if (!files.length) {
        return;
      }

      const availableSlots = MAX_COMPOSER_ATTACHMENTS - composerAttachments.length;
      if (availableSlots <= 0) {
        setErrorNotice(`You can attach up to ${MAX_COMPOSER_ATTACHMENTS} images.`);
        return;
      }

      const accepted: ComposerAttachment[] = [];

      for (const file of files) {
        if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
          setErrorNotice(`Unsupported image type: ${file.type || 'unknown'}`);
          continue;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          setErrorNotice(
            `Image ${file.name} exceeds ${(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)).toFixed(
              1
            )} MB limit.`
          );
          continue;
        }

        if (accepted.length >= availableSlots) {
          break;
        }

        try {
          const { dataUrl, base64 } = await readFileAsDataUrl(file);
          if (!base64) {
            setErrorNotice(`Unable to process image ${file.name}.`);
            continue;
          }

          accepted.push({
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type,
            size: file.size,
            dataUrl,
            base64
          });
        } catch (error) {
          setErrorNotice(
            error instanceof Error
              ? `Unable to read ${file.name}: ${error.message}`
              : `Unable to read ${file.name}`
          );
        }
      }

      if (accepted.length) {
        setComposerAttachments((previous) => [...previous, ...accepted]);
      }
    },
    [composerAttachments.length, readFileAsDataUrl]
  );

  const handleAddImagesClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length) {
      void addAttachments(files);
    }
    event.target.value = '';
  };

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const { items } = event.clipboardData ?? {};
      if (!items) {
        return;
      }

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      if (files.length) {
        void addAttachments(files);
      }
    },
    [addAttachments]
  );

  const handleModelChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!meta || updatingMeta) {
      return;
    }

    const nextModel = event.target.value;
    if (nextModel === meta.model) {
      return;
    }

    const previousMeta = meta;
    setMeta({ ...meta, model: nextModel });
    setUpdatingMeta(true);

    void updateMeta({ model: nextModel })
      .then((updated) => {
        setMeta(updated);
      })
      .catch((error) => {
        console.error('Failed to update model setting', error);
        setMeta(previousMeta);
        setErrorNotice('Unable to update model preference. Please try again.');
      })
      .finally(() => {
        setUpdatingMeta(false);
      });
  };

  const handleToggleReasoning = (messageId: string, nextState?: boolean) => {
    setReasoningExpandedByMessageId((previous) => {
      const current = previous[messageId] ?? defaultReasoningExpanded;
      const desired = typeof nextState === 'boolean' ? nextState : !current;
      if (current === desired) {
        return previous;
      }
      setDefaultReasoningExpanded(desired);
      return { ...previous, [messageId]: desired };
    });
  };

  const renderMessage = (message: Message, detailed: boolean) => {
    const attachments = message.attachments ?? [];
    const allItems = message.items ?? [];
    const reasoningEntries =
      detailed && message.role === 'assistant'
        ? allItems.filter(
            (item) => typeof item.type === 'string' && item.type === 'reasoning'
          )
        : [];
    const hasReasoning = reasoningEntries.length > 0;
    const isReasoningExpanded = hasReasoning
      ? reasoningExpandedByMessageId[message.id] ?? defaultReasoningExpanded
      : false;

  const reasoningBlock =
      hasReasoning && detailed ? (
        <div
          className={`message-reasoning${isReasoningExpanded ? ' expanded' : ''}`}
        >
          {reasoningEntries.map((item, index) => {
            const { text, additional, lines } = summarizeReasoningItem(item);
            const remainingText =
              lines.length > 1 ? lines.slice(1).join('\n') : '';
            const hasRemainingText = remainingText.length > 0;
            const hasAdditional = Boolean(additional && additional.length > 0);
            const hasCollapsibleContent = hasRemainingText || hasAdditional;
            const itemRecord = item as Record<string, unknown>;
            const itemIdValue = itemRecord.id;
            const key =
              typeof itemIdValue === 'string' && itemIdValue.length > 0
                ? itemIdValue
                : `${message.id}-item-${index}`;
            const firstLine =
              lines[0] ??
              (additional
                ? 'Additional reasoning details available.'
                : 'Reasoning details unavailable.');

            return (
              <div
                key={key}
                className={`message-reasoning-entry${
                  hasCollapsibleContent ? ' has-toggle' : ''
                }`}
              >
                <button
                  type="button"
                  className={`message-reasoning-summary${
                    hasCollapsibleContent ? '' : ' static'
                  }`}
                  onClick={
                    hasCollapsibleContent
                      ? () => handleToggleReasoning(message.id)
                      : undefined
                  }
                  aria-expanded={
                    hasCollapsibleContent ? isReasoningExpanded : undefined
                  }
                  aria-label={
                    hasCollapsibleContent
                      ? `Toggle reasoning details for step ${index + 1}`
                      : undefined
                  }
                >
                  <ReactMarkdown
                    className="message-reasoning-text"
                    remarkPlugins={markdownPlugins}
                    components={inlineMarkdownComponents}
                  >
                    {firstLine}
                  </ReactMarkdown>
                  <span className="message-reasoning-meta">
                    <span className="message-reasoning-label">
                      Reasoning{reasoningEntries.length > 1 ? ` ${index + 1}` : ''}
                    </span>
                    {hasCollapsibleContent ? (
                      <span className="message-reasoning-icon" aria-hidden="true">
                        {isReasoningExpanded ? '▴' : '▾'}
                      </span>
                    ) : null}
                  </span>
                </button>
                {isReasoningExpanded && hasCollapsibleContent ? (
                  <div className="message-reasoning-details">
                    {hasRemainingText ? (
                      <ReactMarkdown
                        className="message-reasoning-detail-text"
                        remarkPlugins={markdownPlugins}
                        components={blockMarkdownComponents}
                      >
                        {remainingText}
                      </ReactMarkdown>
                    ) : null}
                    {hasAdditional && additional ? (
                      <pre className="message-reasoning-detail-text message-reasoning-detail-json">
                        {additional}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null;

    return (
      <article key={message.id} className={`message message-${message.role}`}>
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
        {reasoningBlock}
        <pre className="message-content">{message.content}</pre>
        {attachments.length > 0 ? (
          <div className="message-attachments">
            {attachments.map((attachment) => (
              <figure key={attachment.id} className="message-attachment">
                {attachment.mimeType.startsWith('image/') ? (
                  <button
                    type="button"
                    className="message-attachment-image"
                    onClick={() =>
                      setImagePreview({
                        url: attachment.url,
                        filename: attachment.filename
                      })
                    }
                    aria-label={`Preview ${attachment.filename}`}
                  >
                    <img src={attachment.url} alt={attachment.filename} />
                  </button>
                ) : (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="message-attachment-file"
                  >
                    📎
                  </a>
                )}
                <figcaption>
                  {attachment.mimeType.startsWith('image/') ? (
                    <button
                      type="button"
                      className="message-attachment-filename-button"
                      onClick={() =>
                        setImagePreview({
                          url: attachment.url,
                          filename: attachment.filename
                        })
                      }
                    >
                      {attachment.filename}
                    </button>
                  ) : (
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {attachment.filename}
                    </a>
                  )}
                  <span>{formatFileSize(attachment.size)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </article>
    );
  };

  const handleReasoningEffortChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!meta || updatingMeta) {
      return;
    }

    const nextEffort = event.target.value as AppMeta['reasoningEffort'];
    if (nextEffort === meta.reasoningEffort) {
      return;
    }

    const previousMeta = meta;
    setMeta({ ...meta, reasoningEffort: nextEffort });
    setUpdatingMeta(true);

    void updateMeta({ reasoningEffort: nextEffort })
      .then((updated) => {
        setMeta(updated);
      })
      .catch((error) => {
        console.error('Failed to update reasoning effort', error);
        setMeta(previousMeta);
        setErrorNotice('Unable to update reasoning effort. Please try again.');
      })
      .finally(() => {
        setUpdatingMeta(false);
      });
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setComposerAttachments((previous) =>
      previous.filter((attachment) => attachment.id !== attachmentId)
    );
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

    const trimmedContent = composerValue.trim();
    if (!trimmedContent && composerAttachments.length === 0) {
      return;
    }

    setSendingMessage(true);
    setErrorNotice(null);

    try {
      const attachmentUploads = composerAttachments.map((attachment) => ({
        filename: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        base64: attachment.base64
      }));

      const payload = {
        content: trimmedContent,
        attachments: attachmentUploads.length > 0 ? attachmentUploads : undefined
      };

      const result = await safePostMessage(activeSessionId, payload);

      if (result.status === 'ok') {
        const { data } = result;

        setMessages((prev) => [...prev, data.userMessage, data.assistantMessage]);
        setComposerValue('');
        setComposerAttachments([]);

        setSessions((prev) => {
          const updated = prev.map((session) => {
            if (session.id !== activeSessionId) {
              return session;
            }

            let inferredTitle = session.title;
            if (session.title === DEFAULT_SESSION_TITLE) {
              const messageContent = data.userMessage.content.trim();
              if (messageContent.length > 0) {
                inferredTitle =
                  messageContent.length > 60
                    ? `${messageContent.slice(0, 60).trim()}…`
                    : messageContent;
              }
            }

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
          const normalizedErrorMessage = {
            ...apiBody.userMessage,
            attachments: apiBody.userMessage.attachments ?? []
          };
          setMessages((prev) => [
            ...prev,
            normalizedErrorMessage,
            {
              id: `error-${Date.now()}`,
              role: 'system',
              content: `Codex error: ${apiBody.message}`,
              createdAt: new Date().toISOString(),
              attachments: []
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
                <div className="chat-header-title">
                  <h2>{activeSession.title}</h2>
                  <p className="muted">
                    Updated {sessionDateFormatter.format(new Date(activeSession.updatedAt))}
                  </p>
                </div>
                <div className="chat-view-toggle" role="group" aria-label="Chat display mode">
                  <button
                    type="button"
                    className={`chat-view-toggle-button${
                      chatViewMode === 'formatted' ? ' active' : ''
                    }`}
                    onClick={() => setChatViewMode('formatted')}
                    aria-pressed={chatViewMode === 'formatted'}
                  >
                    Chat Output
                  </button>
                  <button
                    type="button"
                    className={`chat-view-toggle-button${isDetailedView ? ' active' : ''}`}
                    onClick={() => setChatViewMode('detailed')}
                    aria-pressed={isDetailedView}
                  >
                    Detailed Output
                  </button>
                  <button
                    type="button"
                    className={`chat-view-toggle-button${isRawView ? ' active' : ''}`}
                    onClick={() => setChatViewMode('raw')}
                    aria-pressed={isRawView}
                  >
                    Raw JSON
                  </button>
                </div>
              </header>

              <div
                className={`message-panel${isRawView ? ' message-panel-raw' : ''}${
                  isDetailedView ? ' message-panel-detailed' : ''
                }`}
              >
                {isRawView ? (
                  loadingMessages ? (
                    <div className="message-placeholder">Loading conversation…</div>
                  ) : (
                    <pre className="message-raw-json" aria-label="Conversation as JSON">
                      {rawMessagesJson}
                    </pre>
                  )
                ) : isDetailedView ? (
                  <div className="message-list message-list-detailed" ref={messageListRef}>
                    {loadingMessages ? (
                      <div className="message-placeholder">Loading conversation…</div>
                    ) : messages.length === 0 ? (
                      <div className="message-placeholder">
                        Send a message to kick off this conversation.
                      </div>
                    ) : (
                      messages.map((message) => renderMessage(message, true))
                    )}
                  </div>
                ) : (
                  <div className="message-list" ref={messageListRef}>
                    {loadingMessages ? (
                      <div className="message-placeholder">Loading conversation…</div>
                    ) : messages.length === 0 ? (
                      <div className="message-placeholder">
                        Send a message to kick off this conversation.
                      </div>
                    ) : (
                      messages.map((message) => renderMessage(message, false))
                    )}
                  </div>
                )}
              </div>

              <form className="composer" onSubmit={handleSendMessage}>
                {composerAttachments.length > 0 ? (
                  <div className="composer-attachments">
                    {composerAttachments.map((attachment) => (
                      <div key={attachment.id} className="composer-attachment">
                        <div className="composer-attachment-preview">
                          <img src={attachment.dataUrl} alt={attachment.name} />
                        </div>
                        <div className="composer-attachment-details">
                          <span className="composer-attachment-name">{attachment.name}</span>
                          <span className="composer-attachment-size">
                            {formatFileSize(attachment.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="composer-attachment-remove"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          aria-label={`Remove ${attachment.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <textarea
                  placeholder="Ask Codex anything…"
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  onPaste={handleComposerPaste}
                  disabled={isComposerDisabled}
                  rows={3}
                />
                <div className="composer-footer">
                  <div className="composer-actions">
                    <button
                      type="button"
                      className="attachment-button"
                      onClick={handleAddImagesClick}
                      disabled={isComposerDisabled}
                    >
                      Images…
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={handleFileInputChange}
                    />
                  </div>
                  <div className="composer-meta">
                    {meta ? (
                      <>
                        <label className="composer-meta-field">
                          <span>Model</span>
                          <select
                            value={meta.model}
                            onChange={handleModelChange}
                            disabled={updatingMeta}
                          >
                            {(meta.availableModels.length > 0
                              ? meta.availableModels
                              : FALLBACK_MODELS
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="composer-meta-field">
                          <span>Reasoning Effort</span>
                          <select
                            value={meta.reasoningEffort}
                            onChange={handleReasoningEffortChange}
                            disabled={updatingMeta}
                          >
                            {(meta.availableReasoningEfforts.length > 0
                              ? meta.availableReasoningEfforts
                              : FALLBACK_REASONING
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option.charAt(0).toUpperCase() + option.slice(1)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {updatingMeta ? (
                          <span className="composer-meta-status">Saving…</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="composer-meta-loading">Loading settings…</span>
                    )}
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

      {imagePreview ? (
        <div
          className="image-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${imagePreview.filename} preview`}
          onClick={() => setImagePreview(null)}
        >
          <div
            className="image-modal-content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="image-modal-close"
              onClick={() => setImagePreview(null)}
              aria-label="Close image preview"
            >
              ×
            </button>
            <img src={imagePreview.url} alt={imagePreview.filename} />
            <div className="image-modal-filename">{imagePreview.filename}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
