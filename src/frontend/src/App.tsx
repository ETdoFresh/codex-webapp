import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  ClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import StatusChip from "./components/StatusChip";
import FileEditorPanel from "./components/FileEditorPanel";
import { useHealthStatus } from "./hooks/useHealthStatus";
import {
  ApiError,
  createSession,
  deleteSession,
  fetchMeta,
  fetchSessionWorkspaceInfo,
  fetchMessages,
  fetchSessions,
  streamPostMessage,
  updateMeta,
  updateSessionTitle,
  setSessionTitleLock,
  autoUpdateSessionTitle,
  type AutoTitleMessagePayload,
  getSessionContainerStatus,
  createSessionContainer,
  getSessionSettings,
} from "./api/client";
import type {
  AppMeta,
  Message,
  PostMessageErrorResponse,
  Session,
  TurnItem,
  SessionWorkspaceInfo,
} from "./api/types";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import WorkspaceRootModal from "./components/WorkspaceRootModal";
import DeployPanel from "./components/DeployPanel";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import AdminPanel from "./components/AdminPanel";
import DokployPanel from "./components/DokployPanel";
import GitHubConnectionPanel from "./components/GitHubConnectionPanel";
import SessionSettingsModal, {
  type SessionSettings,
} from "./components/SessionSettingsModal";

const DEFAULT_SESSION_TITLE = "New Session";
const THEME_STORAGE_KEY = "codex:theme";
const LAST_PROVIDER_STORAGE_KEY = "codex:last-provider";
const LAST_MODEL_STORAGE_KEY = "codex:last-model";
const LAST_REASONING_STORAGE_KEY = "codex:last-reasoning";

const FALLBACK_MODELS = ["gpt-5-codex", "gpt-5"];
const FALLBACK_PROVIDERS: AppMeta["provider"][] = ["CodexSDK"];
const FALLBACK_REASONING: AppMeta["reasoningEffort"][] = [
  "low",
  "medium",
  "high",
];

const getModelOptionsForProvider = (
  meta: AppMeta,
  provider: AppMeta["provider"],
): string[] => {
  const providerModels = meta.modelsByProvider?.[provider];
  if (providerModels && providerModels.length > 0) {
    return providerModels;
  }
  if (meta.availableModels.length > 0) {
    return meta.availableModels;
  }
  return FALLBACK_MODELS;
};

const safeGetLocalStorageItem = (key: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
};

const safeSetLocalStorageItem = (key: string, value: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    // Ignore quota/security errors; fallback to defaults next load.
  }
};

const isProviderValue = (value: string | null): value is AppMeta["provider"] =>
  value === "CodexSDK" ||
  value === "ClaudeCodeSDK" ||
  value === "DroidCLI" ||
  value === "CopilotCLI" ||
  value === "GeminiSDK";

const isReasoningValue = (
  value: string | null,
): value is AppMeta["reasoningEffort"] =>
  value === "low" || value === "medium" || value === "high";

type Theme = "light" | "dark";

const getInitialTheme = (): Theme => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "dark";
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
      return stored;
    }
  } catch (error) {
    console.warn("Unable to read theme preference", error);
  }

  document.documentElement.dataset.theme = "dark";
  return "dark";
};

const MAX_COMPOSER_ATTACHMENTS = 4;
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
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
  item: TurnItem,
): { text: string | null; additional: string | null; lines: string[] } => {
  const record = item as Record<string, unknown>;
  const rawText = record.text;
  const candidateText = typeof rawText === "string" ? rawText.trim() : "";

  const text = candidateText.length > 0 ? candidateText : null;

  const clone: Record<string, unknown> = { ...item };
  delete clone.type;
  if ("text" in clone) {
    delete clone.text;
  }
  if ("id" in clone) {
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

const ITEM_EMOJIS: Record<string, string> = {
  reasoning: "\u{1f9e0}",
  agent_message: "\u{1f4ac}",
  file_change: "\u{1f4dd}",
  command_execution: "\u{1f6e0}\u{fe0f}",
  mcp_tool_call: "\u{1f916}",
  web_search: "\u{1f50d}",
  todo_list: "\u{1f5d2}\u{fe0f}",
  error: "\u{26a0}\u{fe0f}",
};

const STREAMING_PREVIEW_MAX_LENGTH = 160;

const truncatePreview = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= STREAMING_PREVIEW_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, STREAMING_PREVIEW_MAX_LENGTH).trimEnd()}…`;
};

const buildAutoTitleMessages = (
  messages: Message[],
): AutoTitleMessagePayload[] =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
    attachments: (message.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    items: message.items ?? [],
  }));

const formatTitleCase = (value: string): string =>
  value
    .split(/[\s_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");

const getItemEmoji = (type: string): string => {
  const normalizedType = type.toLowerCase();
  return ITEM_EMOJIS[normalizedType] ?? "\u{1f4cc}";
};

const stripAnsiSequences = (value: string): string =>
  typeof value === "string" ? value.replace(/\u001B\[[\d;]*m/g, "") : value;

const formatStatusLabel = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return formatTitleCase(value.trim());
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const sessionDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "numeric",
});

const isScrolledToBottom = (
  element: HTMLDivElement,
  threshold = 64,
): boolean => {
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= threshold;
};

const sortSessions = (sessions: Session[]) =>
  [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const health = useHealthStatus();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [updatingMeta, setUpdatingMeta] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<
    ComposerAttachment[]
  >([]);
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    filename: string;
  } | null>(null);
  const [chatViewMode, setChatViewMode] = useState<
    "formatted" | "detailed" | "raw" | "editor" | "deploy" | "admin" | "container" | "dokploy" | "github"
  >("formatted");
  const [expandedItemKeys, setExpandedItemKeys] = useState<Set<string>>(
    new Set(),
  );
  const [workspaceInfo, setWorkspaceInfo] = useState<
    SessionWorkspaceInfo | null
  >(null);
  const [titleEditorOpen, setTitleEditorOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleLocking, setTitleLocking] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [sessionSettingsModalOpen, setSessionSettingsModalOpen] = useState(false);
  const [containerStatuses, setContainerStatuses] = useState<
    Record<string, { status: string; url?: string; error?: string }>
  >({});
  const [sessionSettings, setSessionSettings] = useState<{
    gitRemoteUrl: string | null;
    gitBranch: string | null;
  } | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const pendingScrollToBottomRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const titleEditingRef = useRef(false);

  const isRawView = chatViewMode === "raw";
  const isDetailedView = chatViewMode === "detailed";
  const isFileEditorView = chatViewMode === "editor";
  const isDeployView = chatViewMode === "deploy";
  const isContainerView = chatViewMode === "container";
  const isAdminView = chatViewMode === "admin";
  const isDokployView = chatViewMode === "dokploy";
  const isGitHubView = chatViewMode === "github";

  const persistMetaPreferences = useCallback((nextMeta: AppMeta) => {
    safeSetLocalStorageItem(LAST_PROVIDER_STORAGE_KEY, nextMeta.provider);
    safeSetLocalStorageItem(LAST_MODEL_STORAGE_KEY, nextMeta.model);
    safeSetLocalStorageItem(
      LAST_REASONING_STORAGE_KEY,
      nextMeta.reasoningEffort,
    );
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Failed to log out", error);
    }
  }, [logout]);

  const toggleItemExpansion = useCallback((entryKey: string) => {
    setExpandedItemKeys((previous) => {
      const next = new Set(previous);
      if (next.has(entryKey)) {
        next.delete(entryKey);
      } else {
        next.add(entryKey);
      }
      return next;
    });
  }, []);

  const supportsIntersectionObserver = useMemo(
    () => typeof window !== "undefined" && "IntersectionObserver" in window,
    [],
  );

  const updateMessages = useCallback(
    (action: SetStateAction<Message[]>) => {
      if (!isRawView && !isDeployView && !isAdminView && !isDokployView && !isGitHubView) {
        const container = messageListRef.current;
        if (container) {
          const atBottom =
            shouldAutoScrollRef.current || isScrolledToBottom(container);
          shouldAutoScrollRef.current = atBottom;
          if (atBottom) {
            pendingScrollToBottomRef.current = true;
          }
        } else {
          shouldAutoScrollRef.current = true;
          pendingScrollToBottomRef.current = true;
        }
      }
      setMessages(action);
    },
    [isRawView, isDeployView, isAdminView, isDokployView, isGitHubView, setMessages],
  );

  const handleMessageListScroll = useCallback(() => {
    if (isRawView || isDeployView || isAdminView || isDokployView || isGitHubView) {
      return;
    }

    const container = messageListRef.current;
    if (!container) {
      return;
    }

    shouldAutoScrollRef.current = isScrolledToBottom(container);
    if (shouldAutoScrollRef.current) {
      pendingScrollToBottomRef.current = true;
    }
  }, [isRawView, isDeployView, isAdminView, isDokployView, isGitHubView]);

  useEffect(() => {
    if (!supportsIntersectionObserver || isRawView || isDeployView || isAdminView || isDokployView || isGitHubView) {
      return;
    }

    const container = messageListRef.current;
    const sentinel = bottomSentinelRef.current;
    if (!container || !sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target !== sentinel) {
            continue;
          }

          const isNearBottom = entry.isIntersecting || entry.intersectionRatio > 0;
          shouldAutoScrollRef.current = isNearBottom;
          if (isNearBottom) {
            pendingScrollToBottomRef.current = true;
          }
        }
      },
      {
        root: container,
        threshold: [0, 0.25, 0.75, 1],
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isRawView, isDeployView, isAdminView, isDokployView, isGitHubView, supportsIntersectionObserver, messages.length]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const rawMessagesJson = useMemo(
    () => JSON.stringify(messages, null, 2),
    [messages],
  );
  const workspacePathDisplay = useMemo(() => {
    const effectivePath =
      workspaceInfo?.path ?? activeSession?.workspacePath ?? "";

    if (!effectivePath) {
      return {
        display: "Select a workspace…",
        title: "No workspace directory selected.",
      } as const;
    }

    const original = effectivePath;
    const normalized = original.replace(/\\/g, "/");
    const MAX_DISPLAY_LENGTH = 32;
    if (normalized.length <= MAX_DISPLAY_LENGTH) {
      return { display: normalized, title: original } as const;
    }

    const lastSlashIndex = normalized.lastIndexOf("/");

    if (lastSlashIndex === -1) {
      const tailLength = MAX_DISPLAY_LENGTH - 1;
      return {
        display: `…${normalized.slice(-tailLength)}`,
        title: original,
      } as const;
    }

    const secondLastSlashIndex = normalized.lastIndexOf("/", lastSlashIndex - 1);
    const tailStartIndex = secondLastSlashIndex >= 0 ? secondLastSlashIndex : lastSlashIndex;
    let tail = normalized.slice(tailStartIndex);

    if (tail.length >= MAX_DISPLAY_LENGTH - 1) {
      return {
        display: `…${normalized.slice(-(MAX_DISPLAY_LENGTH - 1))}`,
        title: original,
      } as const;
    }

    const headLength = Math.max(1, MAX_DISPLAY_LENGTH - tail.length - 1); // reserve one char for ellipsis
    let head = normalized.slice(0, headLength);
    if (!head.endsWith("/")) {
      const trimIndex = head.lastIndexOf("/");
      if (trimIndex >= 0) {
        head = head.slice(0, trimIndex + 1);
      }
    }
    if (head.length === 0) {
      head = normalized.slice(0, headLength);
    }
    return {
      display: `${head}…${tail}`,
      title: original,
    } as const;
  }, [workspaceInfo, activeSession]);
  const markdownPlugins = useMemo(() => [remarkGfm], []);
  const inlineMarkdownComponents = useMemo<Components>(
    () => ({
      p: ({ node, ...props }) => <span {...props} />,
      a: ({ node, ...props }) => (
        <a {...props} target="_blank" rel="noreferrer" />
      ),
    }),
    [],
  );
  const blockMarkdownComponents = useMemo<Components>(
    () => ({
      a: ({ node, ...props }) => (
        <a {...props} target="_blank" rel="noreferrer" />
      ),
    }),
    [],
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
        console.error("Failed to load sessions", error);
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

  // Poll container statuses
  useEffect(() => {
    if (sessions.length === 0) {
      return;
    }

    const pollStatuses = async () => {
      const statuses: Record<string, { status: string; url?: string; error?: string }> = {};

      for (const session of sessions) {
        // Only poll sessions that might have containers (check if gitBranch exists, which indicates a container was configured)
        if (!session.gitBranch) {
          continue;
        }

        try {
          const status = await getSessionContainerStatus(session.id);
          // Only store status if container exists (not "not_found")
          if (status.status !== "not_found") {
            statuses[session.id] = status;
          }
        } catch (error) {
          // Ignore errors for sessions without containers
          console.debug(`No container for session ${session.id}`);
        }
      }

      setContainerStatuses(statuses);
    };

    void pollStatuses();
    const interval = setInterval(pollStatuses, 5000); // Poll every 5 seconds

    return () => {
      clearInterval(interval);
    };
  }, [sessions]);

  useEffect(() => {
    if (!activeSessionId) {
      updateMessages([]);
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
        updateMessages(data);
      } catch (error) {
        console.error("Failed to load messages", error);
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
  }, [activeSessionId, updateMessages]);

  useEffect(() => {
    if (!activeSessionId) {
      setSessionSettings(null);
      return;
    }

    let canceled = false;
    const loadSettings = async () => {
      try {
        const settings = await getSessionSettings(activeSessionId);
        if (canceled) {
          return;
        }
        setSessionSettings({
          gitRemoteUrl: settings.gitRemoteUrl,
          gitBranch: settings.gitBranch,
        });
      } catch (error) {
        if (!canceled) {
          console.error("Failed to load session settings", error);
          setSessionSettings(null);
        }
      }
    };

    void loadSettings();

    return () => {
      canceled = true;
    };
  }, [activeSessionId]);

  // Auto-switch to GitHub view when returning from OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github_connected") === "true") {
      setChatViewMode("github");
    }
  }, []);

  useEffect(() => {
    if (!isRawView && !isDeployView) {
      shouldAutoScrollRef.current = true;
      pendingScrollToBottomRef.current = true;
    }
  }, [isRawView, isDeployView, activeSessionId]);

  useEffect(() => {
    if (isRawView || isDeployView) {
      return;
    }

    const container = messageListRef.current;
    if (!container) {
      return;
    }

    if (!(pendingScrollToBottomRef.current || shouldAutoScrollRef.current)) {
      return;
    }

    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight;
      shouldAutoScrollRef.current = true;
      pendingScrollToBottomRef.current = false;
    };

    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      window.requestAnimationFrame(() => {
        scrollToBottom();
      });
    } else {
      scrollToBottom();
    }
  }, [messages, chatViewMode]);

  useEffect(() => {
    setComposerAttachments([]);
  }, [activeSessionId]);

  useEffect(() => {
    const validKeys = new Set<string>();
    for (const message of messages) {
      const items = message.items ?? [];
      items.forEach((item, index) => {
        if (!item || typeof item !== "object") {
          return;
        }
        const record = item as { type?: unknown; id?: unknown };
        if (record.type === "file_change") {
          const candidateId =
            typeof record.id === "string" && record.id.length > 0
              ? record.id
              : `${message.id}-item-${index}`;
          validKeys.add(candidateId);
        }
      });
    }

    setExpandedItemKeys((previous) => {
      let changed = false;
      const next = new Set<string>();
      previous.forEach((key) => {
        if (validKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [messages]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!imagePreview) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setImagePreview(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [imagePreview]);

  useEffect(() => {
    let canceled = false;
    const loadMeta = async () => {
      try {
        const settings = await fetchMeta();
        if (canceled) {
          return;
        }

        const storedProviderRaw = safeGetLocalStorageItem(
          LAST_PROVIDER_STORAGE_KEY,
        );
        const storedProvider =
          isProviderValue(storedProviderRaw) &&
          settings.availableProviders.includes(storedProviderRaw)
            ? storedProviderRaw
            : null;

        const storedModelRaw = safeGetLocalStorageItem(
          LAST_MODEL_STORAGE_KEY,
        );
        const storedModel =
          storedModelRaw && settings.availableModels.includes(storedModelRaw)
            ? storedModelRaw
            : null;

        const storedReasoningRaw = safeGetLocalStorageItem(
          LAST_REASONING_STORAGE_KEY,
        );
        const storedReasoning =
          isReasoningValue(storedReasoningRaw) &&
          settings.availableReasoningEfforts.includes(storedReasoningRaw)
            ? storedReasoningRaw
            : null;

        const updates: Partial<{
          provider: AppMeta["provider"];
          model: string;
          reasoningEffort: AppMeta["reasoningEffort"];
        }> = {};

        if (storedProvider && storedProvider !== settings.provider) {
          updates.provider = storedProvider;
        }

        if (storedModel && storedModel !== settings.model) {
          updates.model = storedModel;
        }

        if (storedReasoning && storedReasoning !== settings.reasoningEffort) {
          updates.reasoningEffort = storedReasoning;
        }

        if (Object.keys(updates).length > 0) {
          if (canceled) {
            return;
          }

          setUpdatingMeta(true);
          try {
            const updated = await updateMeta(updates);
            if (!canceled) {
              setMeta(updated);
              persistMetaPreferences(updated);
            }
          } catch (error) {
            console.warn("Failed to apply stored Codex preferences", error);
            if (!canceled) {
              setMeta(settings);
              persistMetaPreferences(settings);
            }
          } finally {
            if (!canceled) {
              setUpdatingMeta(false);
            }
          }
        } else {
          if (!canceled) {
            persistMetaPreferences(settings);
            setMeta(settings);
          }
        }
      } catch (error) {
        console.warn("Failed to load application metadata", error);
      }
    };

    void loadMeta();

    return () => {
      canceled = true;
    };
  }, [persistMetaPreferences]);

  useEffect(() => {
    titleEditingRef.current = titleEditorOpen;
  }, [titleEditorOpen]);

  useEffect(() => {
    setTitleEditorOpen(false);
    setTitleDraft("");
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      setWorkspaceInfo(null);
      return;
    }

    let canceled = false;
    const loadWorkspace = async () => {
      try {
        const info = await fetchSessionWorkspaceInfo(activeSessionId);
        if (!canceled) {
          setWorkspaceInfo(info);
        }
      } catch (error) {
        if (!canceled) {
          console.warn("Failed to load workspace information", error);
          setWorkspaceInfo(null);
        }
      }
    };

    void loadWorkspace();

    return () => {
      canceled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn("Unable to persist theme preference", error);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((previous) => (previous === "dark" ? "light" : "dark"));
  };

  const applySessionUpdate = useCallback((incoming: Session) => {
    setSessions((previous) => {
      let found = false;
      const next = previous.map((session) => {
        if (session.id === incoming.id) {
          found = true;
          return { ...session, ...incoming };
        }
        return session;
      });
      const merged = found ? next : [...previous, incoming];
      return sortSessions(merged);
    });
  }, []);

  const handleTitleLockToggle = useCallback(async () => {
    if (!activeSession || titleLocking) {
      return;
    }

    setTitleLocking(true);
    try {
      const updated = await setSessionTitleLock(
        activeSession.id,
        !activeSession.titleLocked,
      );
      applySessionUpdate(updated);
      if (updated.titleLocked) {
        setTitleEditorOpen(false);
        setTitleDraft("");
      }
    } catch (error) {
      console.error("Failed to toggle title lock", error);
      setErrorNotice("Unable to update title lock. Please try again.");
    } finally {
      setTitleLocking(false);
    }
  }, [activeSession, applySessionUpdate, titleLocking]);

  const handleTitleEditStart = useCallback(() => {
    if (!activeSession || activeSession.titleLocked) {
      return;
    }
    setTitleDraft(activeSession.title);
    setTitleEditorOpen(true);
  }, [activeSession]);

  const handleTitleEditCancel = useCallback(() => {
    setTitleEditorOpen(false);
    setTitleDraft("");
  }, []);

  const handleTitleEditSave = useCallback(async () => {
    if (!activeSession || titleSaving) {
      return;
    }

    const trimmed = titleDraft.trim();
    if (trimmed.length === 0) {
      setErrorNotice("Session title cannot be empty.");
      return;
    }

    if (trimmed === activeSession.title) {
      setTitleEditorOpen(false);
      return;
    }

    setTitleSaving(true);
    try {
      const updated = await updateSessionTitle(activeSession.id, trimmed);
      applySessionUpdate(updated);
      setTitleEditorOpen(false);
      setTitleDraft("");
    } catch (error) {
      console.error("Failed to update session title", error);
      setErrorNotice("Unable to update session title. Please try again.");
    } finally {
      setTitleSaving(false);
    }
  }, [activeSession, applySessionUpdate, titleDraft, titleSaving]);

  const refreshWorkspaceInfo = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId ?? activeSessionId;
      if (!targetSessionId) {
        setWorkspaceInfo(null);
        return;
      }

      try {
        const info = await fetchSessionWorkspaceInfo(targetSessionId);
        setWorkspaceInfo(info);
      } catch (error) {
        console.warn("Failed to refresh workspace info", error);
      }
    },
    [activeSessionId],
  );

  const readFileAsDataUrl = useCallback(
    (file: File): Promise<{ dataUrl: string; base64: string }> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== "string") {
            reject(new Error("Unable to read file."));
            return;
          }
          const [, base64 = ""] = result.split(",");
          resolve({ dataUrl: result, base64 });
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read file."));
        reader.readAsDataURL(file);
      }),
    [],
  );

  const addAttachments = useCallback(
    async (files: File[]) => {
      if (!files.length) {
        return;
      }

      const availableSlots =
        MAX_COMPOSER_ATTACHMENTS - composerAttachments.length;
      if (availableSlots <= 0) {
        setErrorNotice(
          `You can attach up to ${MAX_COMPOSER_ATTACHMENTS} images.`,
        );
        return;
      }

      const accepted: ComposerAttachment[] = [];

      for (const file of files) {
        if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
          setErrorNotice(`Unsupported image type: ${file.type || "unknown"}`);
          continue;
        }

        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          setErrorNotice(
            `Image ${file.name} exceeds ${(
              MAX_ATTACHMENT_SIZE_BYTES /
              (1024 * 1024)
            ).toFixed(1)} MB limit.`,
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
            base64,
          });
        } catch (error) {
          setErrorNotice(
            error instanceof Error
              ? `Unable to read ${file.name}: ${error.message}`
              : `Unable to read ${file.name}`,
          );
        }
      }

      if (accepted.length) {
        setComposerAttachments((previous) => [...previous, ...accepted]);
      }
    },
    [composerAttachments.length, readFileAsDataUrl],
  );

  const handleAddImagesClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length) {
      void addAttachments(files);
    }
    event.target.value = "";
  };

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const { items } = event.clipboardData ?? {};
      if (!items) {
        return;
      }

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
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
    [addAttachments],
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
        persistMetaPreferences(updated);
      })
      .catch((error) => {
        console.error("Failed to update model setting", error);
        setMeta(previousMeta);
        setErrorNotice("Unable to update model preference. Please try again.");
        persistMetaPreferences(previousMeta);
      })
      .finally(() => {
        setUpdatingMeta(false);
      });
  };

  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!meta || updatingMeta) {
      return;
    }

    const nextProvider = event.target.value as AppMeta["provider"];
    if (nextProvider === meta.provider) {
      return;
    }

    const previousMeta = meta;
    const modelOptions = getModelOptionsForProvider(meta, nextProvider);
    const nextModel = modelOptions.includes(meta.model)
      ? meta.model
      : modelOptions[0] ?? meta.model;

    setMeta({ ...meta, provider: nextProvider, model: nextModel });
    setUpdatingMeta(true);

    const payload =
      nextModel !== previousMeta.model
        ? { provider: nextProvider, model: nextModel }
        : { provider: nextProvider };

    void updateMeta(payload)
      .then((updated) => {
        setMeta(updated);
        persistMetaPreferences(updated);
      })
      .catch((error) => {
        console.error("Failed to update provider setting", error);
        setMeta(previousMeta);
        setErrorNotice(
          "Unable to update provider preference. Please try again.",
        );
        persistMetaPreferences(previousMeta);
      })
      .finally(() => {
        setUpdatingMeta(false);
      });
  };

  const renderMessage = (message: Message, detailed: boolean) => {
    const attachments = message.attachments ?? [];
    const messageItems = message.items ?? [];

    type FlatItemEntry = {
      key: string;
      emoji: string;
      content: JSX.Element;
      expandable?: boolean;
      details?: JSX.Element | null;
    };

    const buildFlatItemEntry = (
      rawItem: TurnItem,
      index: number,
    ): FlatItemEntry | null => {
      if (!rawItem || typeof rawItem !== "object") {
        return null;
      }

      const record = rawItem as Record<string, unknown>;
      const typeValue =
        typeof record.type === "string" && record.type.length > 0
          ? record.type
          : "item";

      if (typeValue === "agent_message") {
        return null;
      }

      const key =
        typeof record.id === "string" && record.id.length > 0
          ? record.id
          : `${message.id}-item-${index}`;
      const emoji = getItemEmoji(typeValue);

      if (typeValue === "reasoning") {
        const summary = summarizeReasoningItem(rawItem);
        const textValue =
          summary.text ?? summary.lines.join(" ") ?? "Reasoning step.";

        return {
          key,
          emoji,
          content: (
            <ReactMarkdown
              className="message-item-reasoning"
              remarkPlugins={markdownPlugins}
              components={blockMarkdownComponents}
            >
              {textValue}
            </ReactMarkdown>
          ),
        };
      }

      const resolveStatusLabel = (): string | null => {
        const baseStatus = formatStatusLabel(record.status);
        if (typeValue === "command_execution") {
          const exitCode = coerceNumber(record.exit_code);
          if (exitCode !== null) {
            return baseStatus
              ? `${baseStatus} · exit ${exitCode}`
              : `Exit ${exitCode}`;
          }
        }
        return baseStatus;
      };

      if (typeValue === "file_change") {
        const changes = Array.isArray(record.changes) ? record.changes : [];
        if (changes.length === 0) {
          return {
            key,
            emoji,
            content: <span>File changes recorded.</span>,
          };
        }

        const firstChange = (changes[0] as Record<string, unknown>) ?? {};
        const pathValue =
          typeof firstChange.path === "string" && firstChange.path.length > 0
            ? firstChange.path
            : "Unknown path";
        const kindValue =
          typeof firstChange.kind === "string" && firstChange.kind.length > 0
            ? formatTitleCase(firstChange.kind)
            : "Updated";
        const suffix =
          changes.length > 1 ? ` (+${changes.length - 1} more)` : "";

        const detailEntries = changes
          .map((change, changeIndex) => {
            if (!change || typeof change !== "object") {
              return null;
            }
            const changeRecord = change as Record<string, unknown>;
            const detailPath =
              typeof changeRecord.path === "string" &&
              changeRecord.path.length > 0
                ? changeRecord.path
                : pathValue;
            const detailKindSource =
              typeof changeRecord.kind === "string" &&
              changeRecord.kind.length > 0
                ? changeRecord.kind
                : kindValue;
            const detailKind = formatTitleCase(String(detailKindSource));
            const diffText = (() => {
              const diff = changeRecord.diff;
              if (typeof diff === "string" && diff.trim().length > 0) {
                return stripAnsiSequences(diff.trim());
              }
              const patch = changeRecord.patch;
              if (typeof patch === "string" && patch.trim().length > 0) {
                return stripAnsiSequences(patch.trim());
              }
              const summary = changeRecord.summary;
              if (typeof summary === "string" && summary.trim().length > 0) {
                return stripAnsiSequences(summary.trim());
              }
              return null;
            })();

            const diffBlock =
              diffText !== null
                ? (() => {
                    const lines = diffText
                      .split(/\r?\n/)
                      .filter(
                        (line, idx, arr) =>
                          !(idx === arr.length - 1 && line.trim().length === 0),
                      );
                    if (lines.length === 0) {
                      return null;
                    }
                    return (
                      <pre className="message-item-pre message-item-pre-diff">
                        {lines.map((line, lineIndex) => {
                          const normalizedLine = stripAnsiSequences(line);
                          const lineClass = normalizedLine.startsWith("+")
                            ? "message-item-diff-line message-item-diff-line-add"
                            : normalizedLine.startsWith("-")
                              ? "message-item-diff-line message-item-diff-line-remove"
                              : normalizedLine.startsWith("@")
                                ? "message-item-diff-line message-item-diff-line-hunk"
                                : "message-item-diff-line";
                          return (
                            <span
                              key={`${key}-detail-${changeIndex}-line-${lineIndex}`}
                              className={lineClass}
                            >
                              {normalizedLine.length > 0
                                ? normalizedLine
                                : "\u00a0"}
                            </span>
                          );
                        })}
                      </pre>
                    );
                  })()
                : null;

            return (
              <div
                key={`${key}-detail-${changeIndex}`}
                className="message-item-file-detail"
              >
                <div className="message-item-file-meta">
                  <span className="message-item-change-kind">{detailKind}</span>
                  <code className="message-item-inline-code">{detailPath}</code>
                </div>
                {diffBlock}
              </div>
            );
          })
          .filter((value): value is JSX.Element => value !== null);

        const details =
          detailEntries.length > 0 ? (
            <div className="message-item-details-list">{detailEntries}</div>
          ) : null;

        return {
          key,
          emoji,
          content: (
            <span>
              {kindValue}{" "}
              <code className="message-item-inline-code">{pathValue}</code>
              {suffix}
            </span>
          ),
          expandable: details !== null,
          details,
        };
      }

      if (typeValue === "command_execution") {
        const commandText =
          typeof record.command === "string" && record.command.trim().length > 0
            ? record.command
            : "Command unavailable.";
        const statusLabel = resolveStatusLabel();
        const aggregatedOutput =
          typeof record.aggregated_output === "string"
            ? record.aggregated_output.trim()
            : "";
        const truncatedOutput =
          aggregatedOutput.length > 160
            ? `${aggregatedOutput.slice(0, 160)}…`
            : aggregatedOutput;

        return {
          key,
          emoji,
          content: (
            <span>
              <code className="message-item-inline-code">{commandText}</code>
              {statusLabel ? ` · ${statusLabel}` : ""}
              {truncatedOutput.length > 0 ? ` · ${truncatedOutput}` : ""}
            </span>
          ),
        };
      }

      if (typeValue === "mcp_tool_call") {
        const server =
          typeof record.server === "string" && record.server.length > 0
            ? record.server
            : null;
        const tool =
          typeof record.tool === "string" && record.tool.length > 0
            ? record.tool
            : null;
        const label =
          server || tool
            ? [server, tool ? `tool: ${tool}` : null]
                .filter(Boolean)
                .join(" · ")
            : "Tool call";
        const statusLabel = resolveStatusLabel();

        return {
          key,
          emoji,
          content: (
            <span>
              {label}
              {statusLabel ? ` · ${statusLabel}` : ""}
            </span>
          ),
        };
      }

      if (typeValue === "web_search") {
        const query =
          typeof record.query === "string" && record.query.trim().length > 0
            ? record.query.trim()
            : "Unknown query";
        return {
          key,
          emoji,
          content: (
            <span>
              Search for <span className="message-item-highlight">{query}</span>
            </span>
          ),
        };
      }

      if (typeValue === "todo_list") {
        const items = Array.isArray(record.items) ? record.items : [];
        if (items.length === 0) {
          return {
            key,
            emoji,
            content: <span>To-do list updated.</span>,
          };
        }

        const summaries = items
          .map((entry, todoIndex) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const todoRecord = entry as Record<string, unknown>;
            const textValue =
              typeof todoRecord.text === "string" && todoRecord.text.length > 0
                ? todoRecord.text
                : `Item ${todoIndex + 1}`;
            const checkbox = Boolean(todoRecord.completed) ? "[x]" : "[ ]";
            return `${checkbox} ${textValue}`;
          })
          .filter((value): value is string => value !== null);
        const preview = summaries.slice(0, 2).join("; ");
        const suffix =
          summaries.length > 2 ? ` (+${summaries.length - 2} more)` : "";

        return {
          key,
          emoji,
          content: <span>{`${preview}${suffix}`}</span>,
        };
      }

      if (typeValue === "error") {
        const messageText =
          typeof record.message === "string" && record.message.trim().length > 0
            ? record.message.trim()
            : "Error reported.";
        return {
          key,
          emoji,
          content: <span className="message-item-error">{messageText}</span>,
        };
      }

      const fallbackText = JSON.stringify(record);
      return {
        key,
        emoji,
        content: <span>{fallbackText}</span>,
      };
    };

    const buildStreamingPreview = (rawItem: TurnItem): string | null => {
      if (!rawItem || typeof rawItem !== "object") {
        return null;
      }

      const record = rawItem as Record<string, unknown>;
      const typeValue =
        typeof record.type === "string" && record.type.length > 0
          ? record.type
          : "";
      const normalizedType = typeValue.toLowerCase();

      if (normalizedType === "reasoning") {
        const summary = summarizeReasoningItem(rawItem);
        const textCandidate =
          summary.text && summary.text.trim().length > 0
            ? summary.text
            : summary.lines.find((line) => line.trim().length > 0) ?? null;
        if (textCandidate) {
          return truncatePreview(textCandidate);
        }
        if (summary.additional && summary.additional.trim().length > 0) {
          return truncatePreview(summary.additional);
        }
        return null;
      }

      if (normalizedType === "file_change") {
        const changes = Array.isArray(record.changes) ? record.changes : [];
        if (changes.length === 0) {
          return "Recording file changes…";
        }
        const firstChange = (changes[0] as Record<string, unknown>) ?? {};
        const pathValue =
          typeof firstChange.path === "string" && firstChange.path.length > 0
            ? firstChange.path
            : "workspace file";
        const kindSource =
          typeof firstChange.kind === "string" && firstChange.kind.length > 0
            ? firstChange.kind
            : "Updated";
        const kindLabel = formatTitleCase(String(kindSource));
        const suffix =
          changes.length > 1 ? ` (+${changes.length - 1} more)` : "";
        return truncatePreview(`${kindLabel} ${pathValue}${suffix}`);
      }

      if (normalizedType === "command_execution") {
        const commandText =
          typeof record.command === "string" && record.command.trim().length > 0
            ? record.command.trim()
            : "Running command";
        const baseStatus = formatStatusLabel(record.status);
        const exitCode = coerceNumber(record.exit_code);
        const statusLabel = exitCode !== null
          ? baseStatus
            ? `${baseStatus} · exit ${exitCode}`
            : `Exit ${exitCode}`
          : baseStatus;
        const aggregatedOutput =
          typeof record.aggregated_output === "string"
            ? record.aggregated_output.trim()
            : "";
        const suffix =
          aggregatedOutput.length > 0
            ? ` · ${truncatePreview(aggregatedOutput)}`
            : "";
        const preview = `${commandText}${statusLabel ? ` · ${statusLabel}` : ""}${suffix}`;
        return truncatePreview(preview);
      }

      if (normalizedType === "mcp_tool_call") {
        const server =
          typeof record.server === "string" && record.server.length > 0
            ? record.server
            : null;
        const tool =
          typeof record.tool === "string" && record.tool.length > 0
            ? record.tool
            : null;
        const labelParts = [server, tool ? `tool: ${tool}` : null].filter(
          (part): part is string => Boolean(part),
        );
        const baseLabel = labelParts.length > 0 ? labelParts.join(" · ") : "Tool call";
        const statusLabel = formatStatusLabel(record.status);
        return truncatePreview(
          statusLabel ? `${baseLabel} · ${statusLabel}` : baseLabel,
        );
      }

      if (normalizedType === "web_search") {
        const query =
          typeof record.query === "string" && record.query.trim().length > 0
            ? record.query.trim()
            : "unknown query";
        return truncatePreview(`Searching for "${query}"`);
      }

      if (normalizedType === "todo_list") {
        const items = Array.isArray(record.items) ? record.items : [];
        if (items.length === 0) {
          return "Updating to-do list";
        }
        const firstItem = (items[0] as Record<string, unknown>) ?? {};
        const textValue =
          typeof firstItem.text === "string" && firstItem.text.trim().length > 0
            ? firstItem.text.trim()
            : "To-do item";
        const checkbox = Boolean(firstItem.completed) ? "[x]" : "[ ]";
        const suffix = items.length > 1 ? ` (+${items.length - 1} more)` : "";
        return truncatePreview(`${checkbox} ${textValue}${suffix}`);
      }

      if (normalizedType === "error") {
        const messageText =
          typeof record.message === "string" && record.message.trim().length > 0
            ? record.message.trim()
            : "Error reported";
        return truncatePreview(messageText);
      }

      const textCandidates: Array<unknown> = [
        record.text,
        record.message,
        record.summary,
        record.title,
      ];
      for (const candidate of textCandidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return truncatePreview(candidate);
        }
      }

      return null;
    };

    const detailedEntries =
      detailed && messageItems.length > 0
        ? messageItems
            .map((item, index) => buildFlatItemEntry(item as TurnItem, index))
            .filter((entry): entry is FlatItemEntry => entry !== null)
        : [];
    const hasDetailedItems = detailedEntries.length > 0;

    const primaryContent =
      typeof message.content === "string" ? message.content : "";
    const trimmedPrimaryContent = primaryContent.trim();
    const fallbackContent = (() => {
      for (const item of messageItems) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const { type } = item as { type?: unknown };
        if (type === "agent_message" || type === "message") {
          const candidate = (item as { text?: unknown }).text;
          if (typeof candidate === "string" && candidate.trim().length > 0) {
            return candidate;
          }
        }
      }
      return "";
    })();
    const displayContent =
      trimmedPrimaryContent.length > 0 ? primaryContent : fallbackContent;
    const trimmedContent = displayContent.trim();
    const hasContent = trimmedContent.length > 0;
    const isStreamingAssistant =
      sendingMessage && message.role === "assistant" && message.id.startsWith("temp-");
    const streamingPreview = isStreamingAssistant
      ? (() => {
          if (trimmedContent.length > 0) {
            return truncatePreview(trimmedContent);
          }
          if (fallbackContent.trim().length > 0) {
            return truncatePreview(fallbackContent);
          }

          const previews: string[] = [];
          for (let index = messageItems.length - 1; index >= 0; index -= 1) {
            const preview = buildStreamingPreview(
              messageItems[index] as TurnItem,
            );
            if (preview) {
              previews.push(preview);
            }
            if (previews.length >= 3) {
              break;
            }
          }

          if (previews.length === 0) {
            return null;
          }

          return previews.reverse().join("\n");
        })()
      : null;
    const detailedItemsBlock = hasDetailedItems ? (
      <>
        <div className="message-items">
          {detailedEntries.map((entry) => {
            const expandable = Boolean(entry.expandable && entry.details);
            const isExpanded = expandedItemKeys.has(entry.key);

            return (
              <div
                key={entry.key}
                className={`message-item-row${expandable ? " message-item-row-expandable" : ""}`}
              >
                {expandable ? (
                  <>
                    <button
                      type="button"
                      className="message-item-toggle"
                      onClick={() => toggleItemExpansion(entry.key)}
                      aria-expanded={isExpanded}
                    >
                      <span
                        className="message-item-expand-icon"
                        aria-hidden="true"
                      >
                        {isExpanded ? "▾" : "▸"}
                      </span>
                      <span className="message-item-icon" aria-hidden="true">
                        {entry.emoji}
                      </span>
                      <span className="message-item-content">
                        {entry.content}
                      </span>
                    </button>
                    {isExpanded && entry.details ? (
                      <div className="message-item-details-block">
                        {entry.details}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="message-item-static">
                    <span className="message-item-icon" aria-hidden="true">
                      {entry.emoji}
                    </span>
                    <span className="message-item-content">
                      {entry.content}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {hasContent ? (
          <div className="message-items-separator" aria-hidden="true" />
        ) : null}
      </>
    ) : null;
    const placeholderText =
      message.role === "assistant"
        ? isStreamingAssistant
          ? streamingPreview ?? "Codex is thinking…"
          : messageItems.length > 0
            ? "Codex responded with structured output."
            : "No response yet."
        : message.role === "user"
          ? "Empty message."
          : "System notice.";

    return (
      <article key={message.id} className={`message message-${message.role}`}>
        <header className="message-meta">
          <span className="message-role">
            {message.role === "assistant"
              ? "Codex"
              : message.role === "user"
                ? "You"
                : "System"}
          </span>
          <span className="message-timestamp">
            {messageTimeFormatter.format(new Date(message.createdAt))}
          </span>
        </header>
        {detailedItemsBlock}
        {hasContent ? (
          <ReactMarkdown
            className="message-content"
            remarkPlugins={markdownPlugins}
            components={blockMarkdownComponents}
          >
            {displayContent}
          </ReactMarkdown>
        ) : (
          <ReactMarkdown
            className="message-content message-empty"
            remarkPlugins={markdownPlugins}
            components={blockMarkdownComponents}
          >
            {placeholderText}
          </ReactMarkdown>
        )}
        {attachments.length > 0 ? (
          <div className="message-attachments">
            {attachments.map((attachment) => (
              <figure key={attachment.id} className="message-attachment">
                {attachment.mimeType.startsWith("image/") ? (
                  <button
                    type="button"
                    className="message-attachment-image"
                    onClick={() =>
                      setImagePreview({
                        url: attachment.url,
                        filename: attachment.filename,
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
                  {attachment.mimeType.startsWith("image/") ? (
                    <button
                      type="button"
                      className="message-attachment-filename-button"
                      onClick={() =>
                        setImagePreview({
                          url: attachment.url,
                          filename: attachment.filename,
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

  const handleReasoningEffortChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    if (!meta || updatingMeta) {
      return;
    }

    const nextEffort = event.target.value as AppMeta["reasoningEffort"];
    if (nextEffort === meta.reasoningEffort) {
      return;
    }

    const previousMeta = meta;
    setMeta({ ...meta, reasoningEffort: nextEffort });
    setUpdatingMeta(true);

    void updateMeta({ reasoningEffort: nextEffort })
      .then((updated) => {
        setMeta(updated);
        persistMetaPreferences(updated);
      })
      .catch((error) => {
        console.error("Failed to update reasoning effort", error);
        setMeta(previousMeta);
        setErrorNotice("Unable to update reasoning effort. Please try again.");
        persistMetaPreferences(previousMeta);
      })
      .finally(() => {
        setUpdatingMeta(false);
      });
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setComposerAttachments((previous) =>
      previous.filter((attachment) => attachment.id !== attachmentId),
    );
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    const { ctrlKey, metaKey, shiftKey } = event;
    const textarea = event.currentTarget;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? value.length;
    const selectionEnd = textarea.selectionEnd ?? value.length;
    const cursorAtEnd =
      selectionStart === value.length && selectionEnd === value.length;
    const shouldSubmit = ctrlKey || metaKey || (!shiftKey && cursorAtEnd);

    if (!shouldSubmit) {
      return;
    }

    event.preventDefault();
    textarea.form?.requestSubmit?.();
  };

  const handleCreateSession = () => {
    setSessionSettingsModalOpen(true);
  };

  const handleSessionSettingsSubmit = async (settings: SessionSettings) => {
    if (creatingSession) {
      return;
    }

    setCreatingSession(true);
    setErrorNotice(null);

    try {
      const session = await createSession(settings);
      setSessions((prev) => sortSessions([session, ...prev]));
      setActiveSessionId(session.id);
      updateMessages([]);
      setComposerValue("");
      shouldAutoScrollRef.current = true;
      pendingScrollToBottomRef.current = true;
      setSessionSettingsModalOpen(false);

      // Note: Container is automatically created by the backend if repo/dockerfile is configured.
      // The container status polling (useEffect below) will show the container creation progress.
    } catch (error) {
      console.error("Failed to create session", error);
      setErrorNotice("Unable to create a new session. Please try again.");
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
    setComposerValue("");
    shouldAutoScrollRef.current = true;
    pendingScrollToBottomRef.current = true;
  };

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetSessionId = activeSessionId;
    if (!targetSessionId || sendingMessage) {
      return;
    }

    const trimmedContent = composerValue.trim();
    if (!trimmedContent && composerAttachments.length === 0) {
      return;
    }

    setSendingMessage(true);
    setErrorNotice(null);

    const attachmentUploads = composerAttachments.map((attachment) => ({
      filename: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      base64: attachment.base64,
    }));

    const payload = {
      content: trimmedContent,
      attachments: attachmentUploads.length > 0 ? attachmentUploads : undefined,
    };

    try {
      const stream = streamPostMessage(targetSessionId, payload);
      let streamCompleted = false;
      let sawAssistantFinal = false;
      let userMessageCreatedAt: string | null = null;

      for await (const streamEvent of stream) {
        const viewingTargetSession =
          activeSessionIdRef.current === targetSessionId;

        if (streamEvent.type === "user_message") {
          const normalizedMessage: Message = {
            ...streamEvent.message,
            attachments: streamEvent.message.attachments ?? [],
            items: streamEvent.message.items ?? [],
          };

          userMessageCreatedAt = normalizedMessage.createdAt;

          if (viewingTargetSession) {
            updateMessages((previous) => [...previous, normalizedMessage]);
            setComposerValue("");
            setComposerAttachments([]);
          }

          setSessions((previous) => {
            let found = false;
            const updated = previous.map((session) => {
              if (session.id !== targetSessionId) {
                return session;
              }

              found = true;
              let inferredTitle = session.title;
              if (!session.titleLocked && session.title === DEFAULT_SESSION_TITLE) {
                const contentForTitle = normalizedMessage.content.trim();
                if (contentForTitle.length > 0) {
                  inferredTitle =
                    contentForTitle.length > 60
                      ? `${contentForTitle.slice(0, 60).trim()}…`
                      : contentForTitle;
                }
              }

              return {
                ...session,
                title: inferredTitle,
                updatedAt: normalizedMessage.createdAt,
              };
            });

            if (!found) {
              updated.push({
                id: targetSessionId,
                title:
                  normalizedMessage.content.trim().length > 0
                    ? normalizedMessage.content.trim()
                    : DEFAULT_SESSION_TITLE,
                codexThreadId: null,
                createdAt: normalizedMessage.createdAt,
                updatedAt: normalizedMessage.createdAt,
                workspacePath:
                  workspaceInfo?.path ?? activeSession?.workspacePath ?? "",
                titleLocked: false,
              });
            }

            return sortSessions(updated);
          });
          continue;
        }

        if (streamEvent.type === "assistant_message_snapshot") {
          if (viewingTargetSession) {
            const normalizedMessage: Message = {
              ...streamEvent.message,
              attachments: streamEvent.message.attachments ?? [],
              items: streamEvent.message.items ?? [],
            };

            updateMessages((previous) => {
              const existingIndex = previous.findIndex(
                (message) => message.id === normalizedMessage.id,
              );
              if (existingIndex >= 0) {
                const nextMessages = [...previous];
                nextMessages[existingIndex] = normalizedMessage;
                return nextMessages;
              }
              return [...previous, normalizedMessage];
            });
          }
          continue;
        }

        if (streamEvent.type === "assistant_message_final") {
          const normalizedMessage: Message = {
            ...streamEvent.message,
            attachments: streamEvent.message.attachments ?? [],
            items: streamEvent.message.items ?? [],
          };

          sawAssistantFinal = true;

          if (viewingTargetSession) {
            updateMessages((previous) => {
              const nextMessages = [...previous];
              const tempIndex = nextMessages.findIndex(
                (message) => message.id === streamEvent.temporaryId,
              );
              if (tempIndex >= 0) {
                nextMessages.splice(tempIndex, 1, normalizedMessage);
              } else {
                nextMessages.push(normalizedMessage);
              }

              if (
                !streamEvent.session.titleLocked &&
                !titleEditingRef.current &&
                nextMessages.length > 0
              ) {
                const autoTitleMessages = buildAutoTitleMessages(nextMessages);
                void autoUpdateSessionTitle(
                  streamEvent.session.id,
                  autoTitleMessages,
                )
                  .then((updatedSession) => {
                    applySessionUpdate(updatedSession);
                  })
                  .catch((error) => {
                    console.warn(
                      "Failed to auto-update session title",
                      error,
                    );
                  });
              }

              return nextMessages;
            });
          }

          applySessionUpdate(streamEvent.session);
          continue;
        }

        if (streamEvent.type === "error") {
          const tempId = streamEvent.temporaryId;
          if (tempId && viewingTargetSession) {
            updateMessages((previous) =>
              previous.filter((message) => message.id !== tempId),
            );
          }

          if (viewingTargetSession) {
            updateMessages((previous) => [
              ...previous,
              {
                id: `error-${Date.now()}`,
                role: "system",
                content: `Codex error: ${streamEvent.message}`,
                createdAt: new Date().toISOString(),
                attachments: [],
              },
            ]);
          }

          setSessions((previous) => sortSessions(previous));
          setErrorNotice(streamEvent.message);
          streamCompleted = true;
        }

        if (streamEvent.type === "done") {
          streamCompleted = true;
        }

        if (streamCompleted) {
          break;
        }
      }

      if (!sawAssistantFinal) {
        const pollForAssistant = async (
          remainingAttempts: number,
        ): Promise<void> => {
          try {
            const latestMessages = await fetchMessages(targetSessionId);
            const latestAssistantMessage = [...latestMessages]
              .reverse()
              .find((message) => message.role === "assistant");

            const hasFinalAssistant =
              latestAssistantMessage &&
              latestAssistantMessage.content.trim().length > 0 &&
              (!userMessageCreatedAt ||
                new Date(latestAssistantMessage.createdAt).getTime() >=
                  new Date(userMessageCreatedAt).getTime());

            if (activeSessionIdRef.current === targetSessionId) {
              updateMessages(latestMessages);
            }

            if (hasFinalAssistant) {
              try {
                const latestSessions = await fetchSessions();
                setSessions(sortSessions(latestSessions));
              } catch (sessionSyncError) {
                console.error(
                  "Failed to synchronize sessions after interrupted stream",
                  sessionSyncError,
                );
              }
              return;
            }
          } catch (syncError) {
            console.error(
              "Failed to synchronize messages after interrupted stream",
              syncError,
            );
          }

          if (remainingAttempts > 0) {
            setTimeout(() => {
              void pollForAssistant(remainingAttempts - 1);
            }, 1000);
          } else {
            console.warn(
              "Stream ended without assistant_message_final; unable to synchronize responses.",
            );
          }
        };

        void pollForAssistant(15);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        const body = error.body;
        if (body && typeof body === "object" && "userMessage" in body) {
          const apiBody = body as PostMessageErrorResponse;
          const normalizedErrorMessage: Message = {
            ...apiBody.userMessage,
            attachments: apiBody.userMessage.attachments ?? [],
            items: apiBody.userMessage.items ?? [],
          };

          if (activeSessionIdRef.current === targetSessionId) {
            updateMessages((previous) => [
              ...previous,
              normalizedErrorMessage,
              {
                id: `error-${Date.now()}`,
                role: "system",
                content: `Codex error: ${apiBody.message}`,
                createdAt: new Date().toISOString(),
                attachments: [],
              },
            ]);
          }

          setSessions((previous) => sortSessions(previous));
          setErrorNotice(apiBody.message);
        } else if (body && typeof body === "object" && "message" in body) {
          const bodyMessage = (body as { message?: unknown }).message;
          if (typeof bodyMessage === "string" && bodyMessage.length > 0) {
            setErrorNotice(bodyMessage);
          } else {
            setErrorNotice("Unexpected error from Codex.");
          }
        } else {
          setErrorNotice("Unexpected error from Codex.");
        }
      } else {
        console.error("Failed to send message", error);
        setErrorNotice(
          "Failed to send message. Check your connection and try again.",
        );
      }
    } finally {
      setSendingMessage(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) {
      return;
    }

    try {
      await deleteSession(sessionId);
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);

      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0]?.id ?? null);
        updateMessages([]);
      }
    } catch (error) {
      console.error("Failed to delete session", error);
      setErrorNotice("Unable to delete the session.");
    }
  };

  const isComposerDisabled =
    !activeSessionId || sendingMessage || loadingMessages || creatingSession;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>webedt (wĕb ĕd′-ĭt)</h1>
          <p className="muted">
            Multi-session workspace with persistent history and full-stack tools
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <StatusChip status={health.status} lastUpdated={health.lastUpdated} />
          <div className="user-badge">
            <span className="user-name">{user?.username}</span>
            {user?.isAdmin ? (
              <button
                type="button"
                className={`ghost-button admin-toggle-button${isAdminView ? " active" : ""}`}
                onClick={() => setChatViewMode(isAdminView ? "formatted" : "admin")}
                aria-pressed={isAdminView}
              >
                Admin
              </button>
            ) : null}
            {user?.isAdmin ? (
              <button
                type="button"
                className={`ghost-button dokploy-toggle-button${isDokployView ? " active" : ""}`}
                onClick={() => setChatViewMode(isDokployView ? "formatted" : "dokploy")}
                aria-pressed={isDokployView}
              >
                Dokploy
              </button>
            ) : null}
            <button
              type="button"
              className={`ghost-button github-toggle-button${isGitHubView ? " active" : ""}`}
              onClick={() => setChatViewMode(isGitHubView ? "formatted" : "github")}
              aria-pressed={isGitHubView}
            >
              GitHub
            </button>
            <button
              type="button"
              className="ghost-button logout-button"
              onClick={() => void handleLogout()}
            >
              Log out
            </button>
          </div>
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
              {creatingSession ? "Creating…" : "New Session"}
            </button>
          </div>

          {loadingSessions ? (
            <p className="sidebar-empty muted">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <div className="sidebar-empty">
              <p className="muted">No sessions yet.</p>
              <button type="button" onClick={() => void handleCreateSession()}>
                Start your first session
              </button>
            </div>
          ) : (
            <ul className="session-list">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const shortId = session.id.slice(0, 8);
                const containerStatus = containerStatuses[session.id];
                const statusIndicator = containerStatus
                  ? containerStatus.status === "running"
                    ? "🟢"
                    : containerStatus.status === "creating"
                      ? "🟡"
                      : containerStatus.status === "stopped"
                        ? "⚪"
                        : "🔴"
                  : "";
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`session-item ${isActive ? "active" : ""}`}
                      onClick={() => handleSelectSession(session.id)}
                    >
                      <span className="session-title">
                        {statusIndicator && <span style={{ marginRight: "0.5em" }}>{statusIndicator}</span>}
                        {session.title}
                      </span>
                      <div className="session-meta">
                        <span className="session-timestamp">
                          {sessionDateFormatter.format(
                            new Date(session.updatedAt),
                          )}
                        </span>
                        {session.gitBranch && (
                          <code className="session-branch-badge" style={{ fontSize: "0.75em", opacity: 0.7 }}>
                            {session.gitBranch}
                          </code>
                        )}
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
          {isAdminView ? (
            <div className="message-panel message-panel-admin">
              <AdminPanel />
            </div>
          ) : isDokployView ? (
            <div className="message-panel message-panel-dokploy">
              <DokployPanel />
            </div>
          ) : isGitHubView ? (
            <div className="message-panel message-panel-github">
              <GitHubConnectionPanel />
            </div>
          ) : activeSession ? (
            <>
              <header className="chat-header">
                <div className="chat-header-title">
                  <div className="chat-header-title-row">
                    {titleEditorOpen ? (
                      <form
                        className="chat-title-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleTitleEditSave();
                        }}
                      >
                        <input
                          type="text"
                          value={titleDraft}
                          onChange={(event) => setTitleDraft(event.target.value)}
                          placeholder="Session title"
                          maxLength={120}
                          disabled={titleSaving}
                        />
                        <div className="chat-title-editor-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={handleTitleEditCancel}
                            disabled={titleSaving}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="ghost-button"
                            disabled={titleSaving}
                          >
                            {titleSaving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <h2>{activeSession.title}</h2>
                        <div className="chat-header-title-actions">
                          <button
                            type="button"
                            className="ghost-button chat-title-button"
                            onClick={() => void handleTitleLockToggle()}
                            disabled={titleLocking || titleSaving}
                            aria-pressed={activeSession.titleLocked}
                            aria-label={
                              activeSession.titleLocked
                                ? "Unlock session title"
                                : "Lock session title"
                            }
                            title={
                              activeSession.titleLocked
                                ? "Unlock session title"
                                : "Lock session title"
                            }
                          >
                            {titleLocking
                              ? "…"
                              : activeSession.titleLocked
                                ? "🔒"
                                : "🔓"}
                          </button>
                          <button
                            type="button"
                            className="ghost-button chat-title-button"
                            onClick={handleTitleEditStart}
                            disabled={
                              activeSession.titleLocked || titleSaving || titleLocking
                            }
                            aria-label="Edit session title"
                            title={
                              activeSession.titleLocked
                                ? "Unlock the title to edit"
                                : "Edit session title"
                            }
                          >
                            ✏️
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <p className="muted">
                    Updated{" "}
                    {sessionDateFormatter.format(
                      new Date(activeSession.updatedAt),
                    )}
                  </p>
                  {sessionSettings?.gitBranch && (
                    <p className="muted" style={{ marginTop: "0.5em" }}>
                      Branch:{" "}
                      <code style={{ fontSize: "0.9em" }}>
                        {sessionSettings.gitBranch}
                      </code>
                    </p>
                  )}
                </div>
                <div className="chat-header-tools">
                  <div className="workspace-controls">
                    <div
                      className="workspace-current"
                      title={workspacePathDisplay.title}
                    >
                      <span className="workspace-current-label">Workspace</span>
                      <code>{workspacePathDisplay.display}</code>
                    </div>
                    <button
                      type="button"
                      className="ghost-button workspace-button"
                      onClick={() => {
                        if (!workspaceInfo) {
                          void refreshWorkspaceInfo();
                        }
                        setWorkspaceModalOpen(true);
                      }}
                      aria-label="Change workspace directory"
                      title="Change workspace directory"
                    >
                      Workspace…
                    </button>
                  </div>
                  <div
                    className="chat-view-toggle"
                    role="group"
                    aria-label="Session display mode"
                  >
                    <button
                      type="button"
                      className={`chat-view-toggle-button${
                        chatViewMode === "formatted" ? " active" : ""
                      }`}
                      onClick={() => setChatViewMode("formatted")}
                      aria-pressed={chatViewMode === "formatted"}
                    >
                      Session Output
                    </button>
                    <button
                      type="button"
                      className={`chat-view-toggle-button${isDetailedView ? " active" : ""}`}
                      onClick={() => setChatViewMode("detailed")}
                      aria-pressed={isDetailedView}
                    >
                      Detailed Output
                    </button>
                    <button
                      type="button"
                      className={`chat-view-toggle-button${isRawView ? " active" : ""}`}
                      onClick={() => setChatViewMode("raw")}
                      aria-pressed={isRawView}
                    >
                      Raw JSON
                    </button>
                    <button
                      type="button"
                      className={`chat-view-toggle-button${
                        isFileEditorView ? " active" : ""
                      }`}
                      onClick={() => setChatViewMode("editor")}
                      aria-pressed={isFileEditorView}
                    >
                      File Editor
                    </button>
                    <button
                      type="button"
                      className={`chat-view-toggle-button${
                        isDeployView ? " active" : ""
                      }`}
                      onClick={() => setChatViewMode("deploy")}
                      aria-pressed={isDeployView}
                    >
                      Deploy
                    </button>
                    <button
                      type="button"
                      className={`chat-view-toggle-button${
                        isContainerView ? " active" : ""
                      }`}
                      onClick={() => setChatViewMode("container")}
                      aria-pressed={isContainerView}
                      disabled={!containerStatuses[activeSessionId || ""]?.url}
                    >
                      Container
                    </button>
                  </div>
                </div>
              </header>

              <div
                className={`message-panel${isRawView ? " message-panel-raw" : ""}${
                  isDetailedView ? " message-panel-detailed" : ""
                }${isFileEditorView ? " message-panel-editor" : ""}${
                  isDeployView ? " message-panel-deploy" : ""
                }`}
              >
                {isFileEditorView ? (
                  <FileEditorPanel
                    key={activeSession.id}
                    sessionId={activeSession.id}
                  />
                ) : isDeployView ? (
                  <DeployPanel />
                ) : isContainerView ? (
                  containerStatuses[activeSessionId || ""]?.url ? (
                    <iframe
                      src={containerStatuses[activeSessionId || ""].url}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                      }}
                      title="Container View"
                    />
                  ) : (
                    <div className="message-placeholder">
                      <p>Container is not ready yet.</p>
                      <p className="muted">
                        Status: {containerStatuses[activeSessionId || ""]?.status || "unknown"}
                      </p>
                      {containerStatuses[activeSessionId || ""]?.error && (
                        <p style={{ color: "red" }}>
                          Error: {containerStatuses[activeSessionId || ""].error}
                        </p>
                      )}
                    </div>
                  )
                ) : isRawView ? (
                  loadingMessages ? (
                    <div className="message-placeholder">
                      Loading session…
                    </div>
                  ) : (
                    <pre
                      className="message-raw-json"
                      aria-label="Conversation as JSON"
                    >
                      {rawMessagesJson}
                    </pre>
                  )
                ) : isDetailedView ? (
                  <div
                    className="message-list message-list-detailed"
                    ref={messageListRef}
                    onScroll={handleMessageListScroll}
                  >
                    {loadingMessages ? (
                      <div className="message-placeholder">
                        Loading conversation…
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="message-placeholder">
                        Send a message to kick off this conversation.
                      </div>
                    ) : (
                      messages.map((message) => renderMessage(message, true))
                    )}
                    <div
                      ref={bottomSentinelRef}
                      className="message-scroll-sentinel"
                      aria-hidden="true"
                    />
                  </div>
                ) : (
                  <div
                    className="message-list"
                    ref={messageListRef}
                    onScroll={handleMessageListScroll}
                  >
                    {loadingMessages ? (
                      <div className="message-placeholder">
                        Loading conversation…
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="message-placeholder">
                        Send a message to kick off this conversation.
                      </div>
                    ) : (
                      messages.map((message) => renderMessage(message, false))
                    )}
                    <div
                      ref={bottomSentinelRef}
                      className="message-scroll-sentinel"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>

              {!(isDeployView || isAdminView) ? (
                <form className="composer" onSubmit={handleSendMessage}>
                {composerAttachments.length > 0 ? (
                  <div className="composer-attachments">
                    {composerAttachments.map((attachment) => (
                      <div key={attachment.id} className="composer-attachment">
                        <div className="composer-attachment-preview">
                          <img src={attachment.dataUrl} alt={attachment.name} />
                        </div>
                        <div className="composer-attachment-details">
                          <span className="composer-attachment-name">
                            {attachment.name}
                          </span>
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
                          <span>Provider</span>
                          <select
                            value={meta.provider}
                            onChange={handleProviderChange}
                            disabled={updatingMeta}
                          >
                            {(meta.availableProviders.length > 0
                              ? meta.availableProviders
                              : FALLBACK_PROVIDERS
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="composer-meta-field">
                          <span>Model</span>
                          <select
                            value={meta.model}
                            onChange={handleModelChange}
                            disabled={updatingMeta}
                          >
                            {getModelOptionsForProvider(meta, meta.provider).map((option) => (
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
                                {option.charAt(0).toUpperCase() +
                                  option.slice(1)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {updatingMeta ? (
                          <span className="composer-meta-status">Saving…</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="composer-meta-loading">
                        Loading settings…
                      </span>
                    )}
                  </div>
                  <button type="submit" disabled={isComposerDisabled}>
                    {sendingMessage ? "Thinking…" : "Send"}
                  </button>
                </div>
                </form>
              ) : null}

              {errorNotice ? (
                <div className="error-banner">{errorNotice}</div>
              ) : null}
            </>
          ) : (
            <div className="empty-chat">
              <p>Select a session or start a new session to begin.</p>
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

      <WorkspaceRootModal
        open={workspaceModalOpen}
        session={activeSession}
        workspaceInfo={workspaceInfo}
        onClose={() => setWorkspaceModalOpen(false)}
        onWorkspaceUpdated={(updatedSession, info) => {
          applySessionUpdate(updatedSession);
          if (activeSessionId === updatedSession.id) {
            setWorkspaceInfo(info);
          }
        }}
      />

      <SessionSettingsModal
        open={sessionSettingsModalOpen}
        onClose={() => setSessionSettingsModalOpen(false)}
        onSubmit={handleSessionSettingsSubmit}
      />
    </div>
  );
}

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

export default App;
  
