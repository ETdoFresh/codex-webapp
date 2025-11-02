import { useEffect, useRef, useState } from "react";
import type { StreamChunk } from "@codex-webapp/shared";

type WebSocketHookResult = {
  connected: boolean;
  lastChunk: StreamChunk | null;
};

/**
 * Hook to connect to main app WebSocket for real-time streaming
 * Note: This connects to the main app's WebSocket, not the container's backend
 */
export function useWebSocket(): WebSocketHookResult {
  const [connected, setConnected] = useState(false);
  const [lastChunk, setLastChunk] = useState<StreamChunk | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("sessionId") || 
                     process.env.SESSION_ID;
    const mainAppWsUrl = process.env.MAIN_APP_WS_URL || "ws://localhost:3000";
    const sessionToken = process.env.SESSION_TOKEN || "";

    if (!sessionId || !sessionToken) {
      console.warn("[Container Frontend] Missing sessionId or sessionToken, WebSocket disabled");
      return;
    }

    const wsUrl = `${mainAppWsUrl}/ws/sessions/${sessionId}?token=${sessionToken}`;
    console.log("[Container Frontend] Connecting to WebSocket:", wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[Container Frontend] WebSocket connected");
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === "stream_chunk") {
          setLastChunk(message as StreamChunk);
        }
      } catch (error) {
        console.error("[Container Frontend] Failed to parse WebSocket message:", error);
      }
    };

    ws.onclose = () => {
      console.log("[Container Frontend] WebSocket disconnected");
      setConnected(false);
    };

    ws.onerror = (error) => {
      console.error("[Container Frontend] WebSocket error:", error);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  return { connected, lastChunk };
}
