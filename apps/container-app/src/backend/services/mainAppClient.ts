import fetch from "node-fetch";
import { WebSocket } from "ws";
import type { Message, WebhookMessagePayload, StreamChunk } from "@codex-webapp/shared";

const SESSION_ID = process.env.SESSION_ID!;
const SESSION_TOKEN = process.env.SESSION_TOKEN!;
const MAIN_APP_URL = process.env.MAIN_APP_URL || "http://localhost:3000";
const MAIN_APP_WS_URL = process.env.MAIN_APP_WS_URL || MAIN_APP_URL.replace(/^http/, "ws");

let wsConnection: WebSocket | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;

/**
 * Post a completed message to the main app for persistence
 */
export async function postMessageToMainApp(
  payload: WebhookMessagePayload,
): Promise<{ messageId: string; createdAt: string }> {
  const url = `${MAIN_APP_URL}/api/container-webhooks/${SESSION_ID}/message`;

  console.log(`[Container] Posting message to main app: ${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SESSION_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to post message to main app: ${response.status} ${text}`);
  }

  const result = await response.json() as any;
  return {
    messageId: result.id,
    createdAt: result.createdAt,
  };
}

/**
 * Fetch message history from the main app
 */
export async function fetchMessagesFromMainApp(): Promise<Message[]> {
  const url = `${MAIN_APP_URL}/api/container-webhooks/${SESSION_ID}/messages`;

  console.log(`[Container] Fetching messages from main app: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SESSION_TOKEN}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch messages from main app: ${response.status} ${text}`);
  }

  return await response.json() as Message[];
}

/**
 * Connect to the main app WebSocket for real-time streaming
 */
export function connectToMainAppWebSocket(): WebSocket {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return wsConnection;
  }

  const wsUrl = `${MAIN_APP_WS_URL}/ws/sessions/${SESSION_ID}?token=${SESSION_TOKEN}&role=container`;
  console.log(`[Container] Connecting to main app WebSocket: ${wsUrl}`);

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("[Container] WebSocket connected to main app");
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log("[Container] Received WebSocket message from main app:", message.type);
    } catch (error) {
      console.error("[Container] Failed to parse WebSocket message:", error);
    }
  });

  ws.on("close", () => {
    console.log("[Container] WebSocket disconnected, will reconnect in 5s");
    wsConnection = null;
    
    // Auto-reconnect
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectToMainAppWebSocket();
      }, 5000);
    }
  });

  ws.on("error", (error) => {
    console.error("[Container] WebSocket error:", error);
  });

  wsConnection = ws;
  return ws;
}

/**
 * Send a stream chunk to the main app via WebSocket
 */
export function streamChunkToMainApp(chunk: StreamChunk): void {
  const ws = connectToMainAppWebSocket();

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      ...chunk,
    }));
  } else {
    console.warn("[Container] WebSocket not ready, chunk dropped");
  }
}

/**
 * Initialize the main app client (connect WebSocket)
 */
export function initializeMainAppClient(): void {
  connectToMainAppWebSocket();
}

/**
 * Cleanup connections
 */
export function shutdownMainAppClient(): void {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
}
