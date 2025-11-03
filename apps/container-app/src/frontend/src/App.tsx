import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "@codex-webapp/shared";
import { useMainAppBridge } from "./hooks/useMainAppBridge";
import { useWebSocket } from "./hooks/useWebSocket";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type WorkspaceFile = {
  path: string;
  size: number;
  updatedAt: string;
};

type WorkspaceFileContent = {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
};

function App() {
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<"CodexSDK" | "ClaudeCodeSDK" | "DroidCLI">("CodexSDK");
  const [model, setModel] = useState("gpt-5-codex");
  const messageListRef = useRef<HTMLDivElement>(null);
  const [streamingContent, setStreamingContent] = useState("");

  // File editor state
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<WorkspaceFileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [editorValue, setEditorValue] = useState("");
  const [saving, setSaving] = useState(false);

  const { sendToMainApp } = useMainAppBridge((message) => {
    console.log("[Container] Received message from main app:", message);
  });

  const { connected: wsConnected, lastChunk } = useWebSocket();

  // Load initial messages
  useEffect(() => {
    async function loadMessages() {
      try {
        const response = await fetch("/api/messages");
        if (!response.ok) {
          throw new Error(`Failed to load messages: ${response.statusText}`);
        }
        const data = await response.json();
        setMessages(data);
      } catch (err) {
        console.error("[Container] Failed to load messages:", err);
        setError(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        setLoading(false);
      }
    }

    loadMessages();
  }, []);

  // Load workspace files
  useEffect(() => {
    async function loadFiles() {
      setLoadingFiles(true);
      try {
        const response = await fetch("/api/workspace/files");
        if (!response.ok) {
          throw new Error("Failed to load files");
        }
        const data = await response.json();
        setFiles(data.files || []);

        // Auto-select first file if available
        if (data.files && data.files.length > 0 && !selectedPath) {
          setSelectedPath(data.files[0].path);
        }
      } catch (err) {
        console.error("[Container] Failed to load workspace files:", err);
      } finally {
        setLoadingFiles(false);
      }
    }

    loadFiles();
  }, []);

  // Load file content when selected
  useEffect(() => {
    if (!selectedPath) {
      setActiveFile(null);
      setEditorValue("");
      return;
    }

    async function loadFile() {
      setLoadingFile(true);
      try {
        const response = await fetch(`/api/workspace/files/${selectedPath}`);
        if (!response.ok) {
          throw new Error("Failed to load file");
        }
        const data = await response.json();
        setActiveFile(data);
        setEditorValue(data.content);
      } catch (err) {
        console.error("[Container] Failed to load file:", err);
      } finally {
        setLoadingFile(false);
      }
    }

    loadFile();
  }, [selectedPath]);

  // Handle streaming chunks
  useEffect(() => {
    if (!lastChunk) {
      return;
    }

    if (lastChunk.type === "content" && lastChunk.content) {
      setStreamingContent(prev => prev + lastChunk.content);
    } else if (lastChunk.type === "complete") {
      setStreamingContent("");

      fetch("/api/messages")
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(err => console.error("[Container] Failed to refresh messages:", err));
    }
  }, [lastChunk]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleSendMessage = useCallback(async () => {
    if (!composerValue.trim() || sending) {
      return;
    }

    setSending(true);
    setError(null);
    setStreamingContent("");

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: composerValue.trim(),
          provider,
          model,
          reasoningEffort: "medium",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send message");
      }

      setComposerValue("");

      const messagesResponse = await fetch("/api/messages");
      if (messagesResponse.ok) {
        const data = await messagesResponse.json();
        setMessages(data);
      }
    } catch (err) {
      console.error("[Container] Failed to send message:", err);
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [composerValue, sending, provider, model]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleSaveFile = async () => {
    if (!activeFile) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/workspace/files/${activeFile.path}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: editorValue,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save file");
      }

      const updated = await response.json();
      setActiveFile(updated);
    } catch (err) {
      console.error("[Container] Failed to save file:", err);
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const isDirty = activeFile ? editorValue !== activeFile.content : false;

  if (loading) {
    return <div className="loading">Loading container...</div>;
  }

  return (
    <div className="editor-layout">
      {/* Left: File Tree */}
      <aside className="file-tree">
        <div className="file-tree-header">
          <h3>Workspace</h3>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ghost-button"
          >
            Refresh
          </button>
        </div>
        <div className="file-list">
          {loadingFiles ? (
            <p className="file-tree-empty">Loading files...</p>
          ) : files.length === 0 ? (
            <p className="file-tree-empty">No files in workspace</p>
          ) : (
            <ul>
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    className={`file-item ${selectedPath === file.path ? "active" : ""}`}
                    onClick={() => setSelectedPath(file.path)}
                  >
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Center: Code Editor */}
      <main className="code-editor">
        <div className="editor-header">
          <h3>{selectedPath || "No file selected"}</h3>
          <div className="editor-actions">
            {isDirty && <span className="dirty-indicator">● Unsaved</span>}
            <button
              type="button"
              onClick={handleSaveFile}
              disabled={!isDirty || saving}
              className="save-button"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        <div className="editor-content">
          {loadingFile ? (
            <div className="editor-placeholder">Loading file...</div>
          ) : !selectedPath ? (
            <div className="editor-placeholder">Select a file to edit</div>
          ) : (
            <textarea
              className="editor-textarea"
              value={editorValue}
              onChange={(e) => setEditorValue(e.target.value)}
              placeholder="Start editing..."
              spellCheck={false}
            />
          )}
        </div>
      </main>

      {/* Right: Chat Panel */}
      <aside className="chat-panel">
        <div className="chat-header">
          <h3>Codex Chat</h3>
          <span className="ws-status">
            {wsConnected ? "🟢" : "🔴"}
          </span>
        </div>

        <div className="message-list" ref={messageListRef}>
          {messages.map((message) => (
            <div key={message.id} className={`message message-${message.role}`}>
              <div className="message-meta">
                <span className="message-role">
                  {message.role === "user" ? "You" : "AI"}
                </span>
                <span className="message-timestamp">
                  {new Date(message.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content || "(Empty message)"}
                </ReactMarkdown>
              </div>
            </div>
          ))}

          {streamingContent && (
            <div className="message message-assistant">
              <div className="message-meta">
                <span className="message-role">AI</span>
                <span className="message-timestamp">Streaming...</span>
              </div>
              <div className="message-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streamingContent}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          {error && <div className="error">{error}</div>}

          <div className="settings-row">
            <select
              className="settings-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
              disabled={sending}
            >
              <option value="CodexSDK">Codex</option>
              <option value="ClaudeCodeSDK">Claude</option>
              <option value="DroidCLI">Droid</option>
            </select>

            <input
              type="text"
              className="settings-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={sending}
              placeholder="Model"
            />
          </div>

          <textarea
            className="composer-textarea"
            value={composerValue}
            onChange={(e) => setComposerValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Codex... (⌘+Enter)"
            disabled={sending}
          />

          <div className="composer-actions">
            <span style={{ fontSize: "0.85em", color: "#666" }}>
              {sending ? "Sending..." : "Ready"}
            </span>
            <button
              className="composer-button"
              onClick={handleSendMessage}
              disabled={sending || !composerValue.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;
