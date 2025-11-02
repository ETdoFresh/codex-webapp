import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "@codex-webapp/shared";
import { useMainAppBridge } from "./hooks/useMainAppBridge";
import { useWebSocket } from "./hooks/useWebSocket";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<"CodexSDK" | "ClaudeCodeSDK" | "DroidCLI">("CodexSDK");
  const [model, setModel] = useState("gpt-5-codex");
  const messageListRef = useRef<HTMLDivElement>(null);
  const [streamingContent, setStreamingContent] = useState("");

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

  // Handle streaming chunks
  useEffect(() => {
    if (!lastChunk) {
      return;
    }

    if (lastChunk.type === "content" && lastChunk.content) {
      setStreamingContent(prev => prev + lastChunk.content);
    } else if (lastChunk.type === "complete") {
      // Stream complete, refresh messages
      setStreamingContent("");
      
      fetch("/api/messages")
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(err => console.error("[Container] Failed to refresh messages:", err));
    }
  }, [lastChunk]);

  // Auto-scroll to bottom
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

      // Clear composer
      setComposerValue("");

      // Refresh messages to show the user message
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

  if (loading) {
    return <div className="loading">Loading container...</div>;
  }

  return (
    <div className="container-app">
      <div className="message-list" ref={messageListRef}>
        {messages.map((message) => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="message-meta">
              <span className="message-role">
                {message.role === "user" ? "You" : "Assistant"}
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
              <span className="message-role">Assistant</span>
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
          <label>
            Provider:
            <select
              className="settings-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
              disabled={sending}
            >
              <option value="CodexSDK">Codex SDK</option>
              <option value="ClaudeCodeSDK">Claude SDK</option>
              <option value="DroidCLI">Droid CLI</option>
            </select>
          </label>

          <label>
            Model:
            <input
              type="text"
              className="settings-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={sending}
              placeholder="Model name"
            />
          </label>

          <span style={{ fontSize: "0.85em", color: "#666" }}>
            WS: {wsConnected ? "🟢 Connected" : "🔴 Disconnected"}
          </span>
        </div>

        <textarea
          className="composer-textarea"
          value={composerValue}
          onChange={(e) => setComposerValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Cmd/Ctrl+Enter to send)"
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
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
