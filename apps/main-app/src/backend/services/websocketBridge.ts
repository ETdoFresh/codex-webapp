import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "node:url";
import { validateSessionToken } from "./sessionTokenService";
import type { StreamChunk } from "@codex-webapp/shared";

type ClientConnection = {
  ws: WebSocket;
  sessionId: string;
  userId: string;
  isContainer: boolean;
};

class WebSocketBridgeService {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientConnection>();

  /**
   * Initialize WebSocket server on the given HTTP server
   */
  initialize(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    // Handle upgrade requests
    httpServer.on("upgrade", (request, socket, head) => {
      const { pathname, query } = parseUrl(request.url ?? "", true);

      // Only handle /ws/sessions/:sessionId paths
      if (!pathname?.startsWith("/ws/sessions/")) {
        socket.destroy();
        return;
      }

      const sessionId = pathname.split("/")[3];
      if (!sessionId) {
        socket.destroy();
        return;
      }

      // Extract and validate token
      const token = query.token as string | undefined;
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        const payload = validateSessionToken(token);

        if (payload.sessionId !== sessionId) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        // Upgrade the connection
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          const isContainer = query.role === "container";
          this.handleConnection(ws, sessionId, payload.userId, isContainer);
        });
      } catch (error) {
        console.error("WebSocket auth error:", error);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      }
    });

    console.log("[WebSocket Bridge] Initialized");
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(
    ws: WebSocket,
    sessionId: string,
    userId: string,
    isContainer: boolean,
  ): void {
    const client: ClientConnection = {
      ws,
      sessionId,
      userId,
      isContainer,
    };

    this.clients.set(ws, client);

    const role = isContainer ? "container" : "client";
    console.log(
      `[WebSocket Bridge] ${role} connected to session ${sessionId}`,
    );

    // Handle messages from clients
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(client, message);
      } catch (error) {
        console.error("[WebSocket Bridge] Invalid message:", error);
      }
    });

    // Handle disconnection
    ws.on("close", () => {
      this.clients.delete(ws);
      console.log(
        `[WebSocket Bridge] ${role} disconnected from session ${sessionId}`,
      );
    });

    // Handle errors
    ws.on("error", (error) => {
      console.error("[WebSocket Bridge] WebSocket error:", error);
      this.clients.delete(ws);
    });

    // Send initial connection acknowledgment
    ws.send(
      JSON.stringify({
        type: "connected",
        sessionId,
      }),
    );
  }

  /**
   * Handle incoming message from a client
   */
  private handleMessage(client: ClientConnection, message: any): void {
    // If this is a container sending a stream chunk, broadcast to all clients watching this session
    if (client.isContainer && message.type === "stream_chunk") {
      this.broadcastToSession(client.sessionId, message, client.ws);
    }
  }

  /**
   * Broadcast a message to all clients watching a specific session (except sender)
   */
  private broadcastToSession(
    sessionId: string,
    message: any,
    senderWs?: WebSocket,
  ): void {
    let count = 0;
    for (const [ws, client] of this.clients.entries()) {
      if (
        client.sessionId === sessionId &&
        !client.isContainer &&
        ws !== senderWs &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(JSON.stringify(message));
        count++;
      }
    }
    
    if (count > 0) {
      console.log(
        `[WebSocket Bridge] Broadcasted to ${count} clients for session ${sessionId}`,
      );
    }
  }

  /**
   * Public method to broadcast stream chunks to a session
   * Can be called from HTTP routes
   */
  broadcastStreamChunk(sessionId: string, chunk: StreamChunk): void {
    this.broadcastToSession(sessionId, {
      type: "stream_chunk",
      ...chunk,
    });
  }

  /**
   * Close all connections and shut down the WebSocket server
   */
  shutdown(): void {
    if (!this.wss) {
      return;
    }

    console.log("[WebSocket Bridge] Shutting down...");

    for (const ws of this.clients.keys()) {
      ws.close();
    }

    this.clients.clear();

    this.wss.close(() => {
      console.log("[WebSocket Bridge] Closed");
    });

    this.wss = null;
  }
}

// Export singleton instance
export const websocketBridge = new WebSocketBridgeService();
